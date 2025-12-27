import { MODULE_ID } from "./constants.js";
import { EditCardApplication } from "./edit-card.js";
import { NodeInfoApplication } from "./node-info.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TalentTreeApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-talent-tree`,
    tag: "div",
    window: {
      title: "Árvore de Talentos",
      icon: "fas fa-sitemap",
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 900,
      height: 700,
    },
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/talent-tree.hbs`,
    },
  };

  constructor(actor, options = {}) {
    const defaultOptions = foundry.utils.mergeObject({}, TalentTreeApplication.DEFAULT_OPTIONS);
    defaultOptions.window.title = game.i18n.localize(`${MODULE_ID}.talent-tree.title`);
    super(foundry.utils.mergeObject(defaultOptions, options));
    this.actor = actor;
    this.isGM = game.user.isGM;
    this.isOwner = actor.isOwner;
    this._drawConnectionsTimeout = null; // Para debounce das chamadas
  }

  static async openForActor(actor) {
    // Verificar permissões
    if (!actor) {
      ui.notifications.error(game.i18n.localize(`${MODULE_ID}.talent-tree.no-actor-selected`));
      return;
    }

    if (!game.user.isGM && !actor.isOwner) {
      ui.notifications.error(game.i18n.localize(`${MODULE_ID}.talent-tree.permission-error`));
      return;
    }

    // Verificar se já existe uma instância aberta
    const existingApp = ui.applications ? Object.values(ui.applications).find(
      (app) => app instanceof TalentTreeApplication && app.actor && app.actor.id === actor.id
    ) : null;

    if (existingApp) {
      existingApp.bringToTop();
      return;
    }

    const app = new TalentTreeApplication(actor);
    app.render(true);
    return app;
  }

  async _prepareContext(options) {
    const talentTreeData = this.getTalentTreeData();
    const allDomains = this.getAllAvailableDomains();
    
    // Calcular nós disponíveis para cada domínio
    const allAvailableNodes = [];
    talentTreeData.domains.forEach(domain => {
      const availableNodes = this.getAvailableNodes(domain);
      allAvailableNodes.push(...availableNodes);
    });
    
    // Processar nós para adicionar flag isImage
    const processedTalentTreeData = {
      ...talentTreeData,
      availableNodes: allAvailableNodes,
      domains: talentTreeData.domains.map(domain => ({
        ...domain,
        nodes: domain.nodes.map(node => {
          // Verificar se o ícone é uma imagem (URL) ou um ícone Font Awesome
          // Se já tiver a flag isImage definida, usar ela (preservar quando definida pela associação)
          let isImage = node.isImage;
          
          if (isImage === undefined && node.icon) {
            // Detectar automaticamente se é uma imagem:
            // - URLs (http/https)
            // - Caminhos absolutos (começam com /)
            // - Data URIs (data:)
            // - Caminhos relativos que contêm extensões de imagem (.png, .jpg, etc) e não são classes Font Awesome
            const hasImageExtension = /\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/i.test(node.icon);
            const isFontAwesome = node.icon.startsWith("fas ") || 
                                  node.icon.startsWith("fa ") || 
                                  node.icon.startsWith("fab ") ||
                                  node.icon.startsWith("far ") ||
                                  node.icon.startsWith("fal ");
            
            isImage = (
              node.icon.startsWith("http://") || 
              node.icon.startsWith("https://") || 
              node.icon.startsWith("/") ||
              node.icon.startsWith("data:") ||
              (hasImageExtension && !isFontAwesome)
            );
          }
          
          return {
            ...node,
            isImage: isImage || false
          };
        })
      }))
    };
    
    // Pré-localizar strings para o template
    const i18n = {
      title: game.i18n.localize(`${MODULE_ID}.talent-tree.title`),
      selectDomain: game.i18n.localize(`${MODULE_ID}.talent-tree.select-domain`),
      addDomain: game.i18n.localize(`${MODULE_ID}.talent-tree.add-domain`),
      removeDomain: game.i18n.localize(`${MODULE_ID}.talent-tree.remove-domain`),
      noDomains: game.i18n.localize(`${MODULE_ID}.talent-tree.no-domains`),
      noNodes: game.i18n.localize(`${MODULE_ID}.talent-tree.no-nodes`),
      level: game.i18n.localize(`${MODULE_ID}.talent-tree.level`),
      increaseLevel: game.i18n.localize(`${MODULE_ID}.talent-tree.increase-level`),
      decreaseLevel: game.i18n.localize(`${MODULE_ID}.talent-tree.decrease-level`),
    };
    
    return {
      actor: this.actor,
      actorName: this.actor.name,
      talentTree: processedTalentTreeData,
      allDomains: allDomains,
      isGM: this.isGM,
      isOwner: this.isOwner,
      canEdit: this.isGM, // Apenas GM pode editar
      i18n: i18n,
    };
  }

  getTalentTreeData() {
    // Primeiro, tentar ler de actor flags (permite que jogadores salvem)
    let treeData = this.actor.getFlag(MODULE_ID, "talentTree") || null;
    
    // Se não existe em flags, tentar ler de settings (compatibilidade com dados antigos)
    if (!treeData) {
      const allTrees = game.settings.get(MODULE_ID, "talentTrees") || {};
      treeData = allTrees[this.actor.id] || null;
      
      // Se encontrou em settings, migrar para flags
      if (treeData && this.actor.isOwner) {
        this.actor.setFlag(MODULE_ID, "talentTree", treeData).catch(() => {
          // Se falhar, continuar usando settings
        });
      }
    }
    
    // Se ainda não existe, criar estrutura padrão
    if (!treeData) {
      treeData = {
        domains: [],
        unlockedNodes: [],
        currentLevel: 1,
        maxLevel: 7,
      };
    }
    
    // Garantir que currentLevel e maxLevel existam
    if (treeData.currentLevel === undefined) {
      treeData.currentLevel = 1;
    }
    if (treeData.maxLevel === undefined) {
      treeData.maxLevel = 7;
    }
    
    return treeData;
  }
  
  // Calcular quais nós estão disponíveis para desbloqueio baseado nas conexões
  getAvailableNodes(domain) {
    const talentTreeData = this.getTalentTreeData();
    const availableNodes = [];
    
    // Se não há nós desbloqueados, o primeiro nó (sem conexões de entrada) está disponível
    if (talentTreeData.unlockedNodes.length === 0) {
      // Encontrar o nó inicial (aquele que não tem outros nós apontando para ele)
      const allNodeIds = domain.nodes.map(n => n.id);
      const nodesWithIncomingConnections = new Set();
      
      domain.nodes.forEach(node => {
        if (node.connections) {
          node.connections.forEach(connId => {
            nodesWithIncomingConnections.add(connId);
          });
        }
      });
      
      // Nós sem conexões de entrada são os nós iniciais
      domain.nodes.forEach(node => {
        if (!nodesWithIncomingConnections.has(node.id)) {
          availableNodes.push(node.id);
        }
      });
    } else {
      // Para cada nó desbloqueado, seus nós conectados estão disponíveis
      const unlockedNodeIds = new Set(talentTreeData.unlockedNodes);
      
      domain.nodes.forEach(node => {
        // Se o nó já está desbloqueado, não está disponível
        if (unlockedNodeIds.has(node.id)) {
          return;
        }
        
        // Verificar se algum nó desbloqueado tem conexão para este nó
        const hasUnlockedConnection = domain.nodes.some(unlockedNode => {
          if (!unlockedNodeIds.has(unlockedNode.id)) {
            return false;
          }
          // Verificar se o nó desbloqueado tem este nó em suas conexões
          return unlockedNode.connections && unlockedNode.connections.includes(node.id);
        });
        
        if (hasUnlockedConnection) {
          availableNodes.push(node.id);
        }
      });
    }
    
    return availableNodes;
  }
  
  // Encontrar o primeiro nó (sem conexões de entrada)
  getFirstNode(domain) {
    const allNodeIds = domain.nodes.map(n => n.id);
    const nodesWithIncomingConnections = new Set();
    
    domain.nodes.forEach(node => {
      if (node.connections) {
        node.connections.forEach(connId => {
          nodesWithIncomingConnections.add(connId);
        });
      }
    });
    
    // Retornar o primeiro nó sem conexões de entrada
    const firstNode = domain.nodes.find(node => !nodesWithIncomingConnections.has(node.id));
    return firstNode ? firstNode.id : null;
  }
  
  // Verificar se um nó tem filhos desbloqueados
  hasUnlockedChildren(nodeId, domain, unlockedNodes) {
    const node = domain.nodes.find(n => n.id === nodeId);
    if (!node || !node.connections) {
      return false;
    }
    
    // Verificar se algum dos nós conectados (filhos) está desbloqueado
    return node.connections.some(connectionId => unlockedNodes.includes(connectionId));
  }
  
  // Bloquear recursivamente todos os filhos de um nó
  lockChildrenRecursively(nodeId, domain, unlockedNodes) {
    const node = domain.nodes.find(n => n.id === nodeId);
    if (!node || !node.connections) {
      return [];
    }
    
    const lockedChildren = [];
    
    node.connections.forEach(connectionId => {
      if (unlockedNodes.includes(connectionId)) {
        // Remover o filho
        const index = unlockedNodes.indexOf(connectionId);
        if (index > -1) {
          unlockedNodes.splice(index, 1);
          lockedChildren.push(connectionId);
          
          // Bloquear recursivamente os filhos deste filho
          const grandChildren = this.lockChildrenRecursively(connectionId, domain, unlockedNodes);
          lockedChildren.push(...grandChildren);
        }
      }
    });
    
    return lockedChildren;
  }

  getAllAvailableDomains() {
    // Obter todos os domínios do sistema (padrão + homebrew)
    if (CONFIG.DH?.DOMAIN?.allDomains) {
      return CONFIG.DH.DOMAIN.allDomains();
    }
    return {};
  }

  async saveTalentTreeData(data) {
    // Verificar se o usuário é dono do personagem
    if (!this.actor.isOwner) {
      ui.notifications.error("Você não tem permissão para modificar este personagem.");
      return;
    }
    
    // Salvar em actor flags (permite que jogadores salvem dados do próprio personagem)
    try {
      await this.actor.setFlag(MODULE_ID, "talentTree", data);
      
      // Também salvar em settings para compatibilidade (apenas se for GM)
      if (this.isGM) {
        const allTrees = game.settings.get(MODULE_ID, "talentTrees") || {};
        allTrees[this.actor.id] = data;
        await game.settings.set(MODULE_ID, "talentTrees", allTrees);
      }
    } catch (error) {
      ui.notifications.error(`Erro ao salvar dados da árvore de talentos: ${error.message}`);
      throw error;
    }
    
    await this.render(false);
    // Redesenhar conexões após o render (será chamado pelo _onRender)
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this._attachListeners();
    // Usar debounce para evitar múltiplas chamadas
    this._scheduleDrawConnections();
  }
  
  _scheduleDrawConnections() {
    // Limpar timeout anterior se existir
    if (this._drawConnectionsTimeout) {
      clearTimeout(this._drawConnectionsTimeout);
    }
    // Agendar nova chamada
    this._drawConnectionsTimeout = setTimeout(() => {
      this._drawConnections();
      this._drawConnectionsTimeout = null;
    }, 100);
  }

  _drawConnections() {
    if (!this.element) {
      return;
    }

    const $element = this.element instanceof jQuery ? this.element : $(this.element);
    const talentTreeVisuals = $element.find(".talent-tree-visual");


    talentTreeVisuals.each((index, visual) => {
      const $visual = $(visual);
      const $svg = $visual.find(".talent-connections-overlay");
      const domainId = $svg.data("domain-id");
      
      if (!$svg.length || !$svg[0]) {
        return;
      }

      // Limpar linhas anteriores COMPLETAMENTE (tanto line quanto path)
      const previousLines = $svg.find("line, path");
      console.log(`${MODULE_ID} | [DRAW CONNECTIONS] Removendo ${previousLines.length} linhas anteriores`);
      previousLines.remove();

      // Obter dados dos nós do contexto
      const talentTreeData = this.getTalentTreeData();
      const domain = talentTreeData.domains.find(d => d.id === domainId);
      
      if (!domain || !domain.nodes) {
        return;
      }

      // Obter dimensões do SVG e do container visual
      const svgElement = $svg[0];
      const visualRect = visual.getBoundingClientRect();
      
      // Configurar o SVG completamente
      svgElement.setAttribute("viewBox", `0 0 ${visualRect.width} ${visualRect.height}`);
      svgElement.setAttribute("preserveAspectRatio", "none");
      svgElement.setAttribute("style", "position: absolute; top: 0; left: 0; pointer-events: none; z-index: 1; width: 100%; height: 100%;");
      
      // Garantir que os defs existam
      let defs = svgElement.querySelector("defs");
      if (!defs) {
        defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        svgElement.appendChild(defs);
      }
      
      // Criar marcadores se não existirem
      const markerId = `arrowhead-${domainId}`;
      const markerUnlockedId = `arrowhead-unlocked-${domainId}`;
      
      if (!defs.querySelector(`#${markerId}`)) {
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
        marker.setAttribute("id", markerId);
        marker.setAttribute("markerWidth", "8");
        marker.setAttribute("markerHeight", "8");
        marker.setAttribute("refX", "7");
        marker.setAttribute("refY", "3");
        marker.setAttribute("orient", "auto");
        marker.setAttribute("markerUnits", "userSpaceOnUse");
        const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        polygon.setAttribute("points", "0 0, 8 3, 0 6");
        polygon.setAttribute("fill", "#666677");
        marker.appendChild(polygon);
        defs.appendChild(marker);
      }
      
      // Sempre recriar o marcador desbloqueado para garantir que está presente
      const existingUnlockedMarker = defs.querySelector(`#${markerUnlockedId}`);
      if (existingUnlockedMarker) {
        existingUnlockedMarker.remove();
      }
      
      const markerUnlocked = document.createElementNS("http://www.w3.org/2000/svg", "marker");
      markerUnlocked.setAttribute("id", markerUnlockedId);
      markerUnlocked.setAttribute("markerWidth", "12");
      markerUnlocked.setAttribute("markerHeight", "12");
      markerUnlocked.setAttribute("refX", "10");
      markerUnlocked.setAttribute("refY", "6");
      markerUnlocked.setAttribute("orient", "auto");
      markerUnlocked.setAttribute("markerUnits", "userSpaceOnUse");
      const polygonUnlocked = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      polygonUnlocked.setAttribute("points", "0 0, 12 6, 0 12");
      // Usar uma cor verde mais escura e sólida para melhor visibilidade sobre a linha brilhante
      polygonUnlocked.setAttribute("fill", "#1b5e20");
      polygonUnlocked.setAttribute("stroke", "#4caf50");
      polygonUnlocked.setAttribute("stroke-width", "1.5");
      markerUnlocked.appendChild(polygonUnlocked);
      defs.appendChild(markerUnlocked);

      // Obter todos os nós deste domínio
      const $nodes = $visual.find(".talent-node-wrapper");
      const nodesMap = {};

      $nodes.each((i, nodeEl) => {
        const $node = $(nodeEl);
        const nodeId = $node.data("node-id");
        const nodeRect = nodeEl.getBoundingClientRect();
        
        // Calcular posição relativa ao container visual (que é a mesma referência do SVG)
        const centerX = nodeRect.left - visualRect.left + (nodeRect.width / 2);
        const centerY = nodeRect.top - visualRect.top + (nodeRect.height / 2);
        
        nodesMap[nodeId] = {
          element: $node,
          centerX: centerX,
          centerY: centerY,
          nodeId: nodeId
        };
      });

      // Verificar se todos os nós foram mapeados
      if (Object.keys(nodesMap).length === 0) {
        this._scheduleDrawConnections();
        return;
      }
      
      // Adicionar filtro de brilho para linhas desbloqueadas (se não existir)
      // defs já foi criado acima, apenas verificar o filtro
      if (defs && !defs.querySelector("#glow-green")) {
        const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
        filter.setAttribute("id", "glow-green");
        filter.setAttribute("x", "-50%");
        filter.setAttribute("y", "-50%");
        filter.setAttribute("width", "200%");
        filter.setAttribute("height", "200%");
        
        const feGaussianBlur = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
        feGaussianBlur.setAttribute("stdDeviation", "2");
        feGaussianBlur.setAttribute("result", "coloredBlur");
        
        const feMerge = document.createElementNS("http://www.w3.org/2000/svg", "feMerge");
        const feMergeNode1 = document.createElementNS("http://www.w3.org/2000/svg", "feMergeNode");
        feMergeNode1.setAttribute("in", "coloredBlur");
        const feMergeNode2 = document.createElementNS("http://www.w3.org/2000/svg", "feMergeNode");
        feMergeNode2.setAttribute("in", "SourceGraphic");
        
        feMerge.appendChild(feMergeNode1);
        feMerge.appendChild(feMergeNode2);
        filter.appendChild(feGaussianBlur);
        filter.appendChild(feMerge);
        defs.appendChild(filter);
      }

      // Obter nós disponíveis para desbloqueio
      const availableNodes = this.getAvailableNodes(domain);
      
      // Criar um Set para rastrear linhas já desenhadas (evitar duplicatas)
      const drawnLines = new Set();
      
      // Função auxiliar para criar uma chave única para uma linha
      const getLineKey = (fromId, toId) => {
        return `${fromId}-${toId}`;
      };
      
      // Função auxiliar para desenhar uma linha
      const drawLine = (fromNode, toNode, fromId, toId, isUnlocked, isAvailable) => {
        const lineKey = getLineKey(fromId, toId);
        
        // Evitar desenhar a mesma linha duas vezes
        if (drawnLines.has(lineKey)) {
          return;
        }
        
        // Calcular distância e ângulo para ajustar o ponto de conexão
        const dx = toNode.centerX - fromNode.centerX;
        const dy = toNode.centerY - fromNode.centerY;
        
        // Raio do nó (aproximadamente 40px, metade de 80px)
        const nodeRadius = 40;
        
        // Calcular pontos de início e fim ajustados para a borda do nó
        const angle = Math.atan2(dy, dx);
        const startX = fromNode.centerX + Math.cos(angle) * nodeRadius;
        const startY = fromNode.centerY + Math.sin(angle) * nodeRadius;
        const endX = toNode.centerX - Math.cos(angle) * nodeRadius;
        const endY = toNode.centerY - Math.sin(angle) * nodeRadius;

        // Usar PATH em vez de LINE para ter mais controle sobre o stroke
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const pathData = `M ${startX} ${startY} L ${endX} ${endY}`;
        path.setAttribute("d", pathData);
        path.setAttribute("fill", "none");
        
        // Se ambos estão desbloqueados, linha verde sólida
        if (isUnlocked) {
          path.setAttribute("stroke", "#4caf50");
          path.setAttribute("stroke-width", "4");
          path.setAttribute("stroke-linecap", "round");
          path.setAttribute("stroke-linejoin", "round");
          // Remover filtro que pode estar causando problemas visuais
          // path.setAttribute("filter", "url(#glow-green)");
          // Garantir que não há stroke-dasharray
          path.removeAttribute("stroke-dasharray");
          path.style.strokeDasharray = "";
          console.log(`${MODULE_ID} | [LINHA VERDE SÓLIDA] Desenhando linha desbloqueada: ${fromId} -> ${toId}, x1=${startX}, y1=${startY}, x2=${endX}, y2=${endY}`);
        } 
        // Se origem está desbloqueada e destino está disponível (mas não desbloqueado), linha dourada SÓLIDA
        else if (isAvailable) {
          path.setAttribute("stroke", "#f3c267");
          path.setAttribute("stroke-width", "3");
          path.setAttribute("stroke-linecap", "round");
          path.setAttribute("stroke-linejoin", "round");
          path.setAttribute("opacity", "0.8");
          // Garantir que não há stroke-dasharray
          path.removeAttribute("stroke-dasharray");
          path.style.strokeDasharray = "";
          console.log(`${MODULE_ID} | [LINHA DOURADA SÓLIDA] Desenhando linha disponível: ${fromId} -> ${toId}`);
        } else {
          return;
        }
        
        // Usar path como line
        const line = path;

        $svg[0].appendChild(line);
        drawnLines.add(lineKey);
        
        // Verificação e correção IMEDIATA após adicionar ao DOM
        // Usar requestAnimationFrame para garantir que o DOM foi atualizado
        requestAnimationFrame(() => {
          // Procurar o path recém-adicionado (agora usamos path em vez de line)
          const allPaths = $svg.find('path');
          const addedPath = Array.from(allPaths).find(p => {
            const d = p.getAttribute('d');
            if (!d) return false;
            // Verificar se o path corresponde às coordenadas
            const match = d.match(/M\s+([\d.]+)\s+([\d.]+)\s+L\s+([\d.]+)\s+([\d.]+)/);
            if (!match) return false;
            const px1 = parseFloat(match[1]);
            const py1 = parseFloat(match[2]);
            const px2 = parseFloat(match[3]);
            const py2 = parseFloat(match[4]);
            return Math.abs(px1 - startX) < 0.1 && Math.abs(px2 - endX) < 0.1 &&
                   Math.abs(py1 - startY) < 0.1 && Math.abs(py2 - endY) < 0.1;
          });
          
          const addedLine = addedPath;
          
          if (addedLine) {
            // Forçar remoção de stroke-dasharray se existir
            if (addedLine.hasAttribute('stroke-dasharray')) {
              addedLine.removeAttribute('stroke-dasharray');
              console.log(`${MODULE_ID} | [CORREÇÃO] Removido stroke-dasharray da linha ${fromId} -> ${toId}`);
            }
            // Forçar remoção do style também
            if (addedLine.style.strokeDasharray) {
              addedLine.style.removeProperty('stroke-dasharray');
              console.log(`${MODULE_ID} | [CORREÇÃO] Removido stroke-dasharray do style da linha ${fromId} -> ${toId}`);
            }
            // SEMPRE forçar via style com !important para garantir linha sólida
            addedLine.style.setProperty('stroke-dasharray', 'none', 'important');
            
            // Verificar computed style
            const computed = window.getComputedStyle(addedLine).strokeDasharray;
            console.log(`${MODULE_ID} | [VERIFICAÇÃO] Linha ${fromId} -> ${toId}: stroke=${addedLine.getAttribute('stroke')}, computed dasharray=${computed}`);
            
            if (computed && computed !== 'none' && computed !== '' && computed !== '0px') {
              // Se ainda tem stroke-dasharray no computed, forçar novamente
              addedLine.style.setProperty('stroke-dasharray', 'none', 'important');
              console.log(`${MODULE_ID} | [CORREÇÃO FORÇADA] stroke-dasharray ainda presente (${computed}), forçando novamente`);
            }
          } else {
            console.warn(`${MODULE_ID} | [ERRO] Linha ${fromId} -> ${toId} não encontrada após adicionar ao DOM`);
          }
        });
        
        return true;
      };
      
      // Desenhar linhas de conexão
      let linesDrawn = 0;
      
      console.log(`${MODULE_ID} | [DRAW CONNECTIONS] Iniciando desenho de conexões para domínio ${domainId}`);
      console.log(`${MODULE_ID} | [DRAW CONNECTIONS] Nós desbloqueados:`, talentTreeData.unlockedNodes);
      console.log(`${MODULE_ID} | [DRAW CONNECTIONS] Nós disponíveis:`, availableNodes);
      
      // Primeiro: desenhar linhas saindo de nós desbloqueados
      domain.nodes.forEach(node => {
        if (!node.connections || node.connections.length === 0) return;

        const fromNode = nodesMap[node.id];
        if (!fromNode) {
          return;
        }

        const isFromNodeUnlocked = talentTreeData.unlockedNodes.includes(node.id);
        
        // Só desenhar linhas saindo de nós desbloqueados
        if (!isFromNodeUnlocked) {
          return;
        }

        node.connections.forEach(connectionId => {
          const toNode = nodesMap[connectionId];
          if (!toNode) {
            return;
          }

          const isToNodeUnlocked = talentTreeData.unlockedNodes.includes(connectionId);
          const isToNodeAvailable = availableNodes.includes(connectionId);

          // Desenhar linha se:
          // 1. Ambos estão desbloqueados (linha verde)
          // 2. OU origem está desbloqueada e destino está disponível (linha dourada)
          if (isToNodeUnlocked || isToNodeAvailable) {
            if (drawLine(fromNode, toNode, node.id, connectionId, isToNodeUnlocked, isToNodeAvailable)) {
              linesDrawn++;
            }
          }
        });
      });
      
      // Segundo: verificar conexões entrando em nós desbloqueados
      // Para cada nó desbloqueado, verificar se algum outro nó desbloqueado tem conexão para ele
      talentTreeData.unlockedNodes.forEach(unlockedNodeId => {
        const toNode = nodesMap[unlockedNodeId];
        if (!toNode) {
          return;
        }
        
        // Procurar todos os nós que têm conexão para este nó desbloqueado
        domain.nodes.forEach(fromNodeData => {
          if (!fromNodeData.connections || !fromNodeData.connections.includes(unlockedNodeId)) {
            return;
          }
          
          const isFromNodeUnlocked = talentTreeData.unlockedNodes.includes(fromNodeData.id);
          
          // Se o nó de origem também está desbloqueado, desenhar linha verde
          if (isFromNodeUnlocked && fromNodeData.id !== unlockedNodeId) {
            const fromNode = nodesMap[fromNodeData.id];
            if (fromNode) {
              if (drawLine(fromNode, toNode, fromNodeData.id, unlockedNodeId, true, false)) {
                linesDrawn++;
                console.log(`${MODULE_ID} | [LINHA BIDIRECIONAL] Desenhando linha de conexão entrando: ${fromNodeData.id} -> ${unlockedNodeId}`);
              }
            }
          }
        });
      });
      
      console.log(`${MODULE_ID} | [DRAW CONNECTIONS] Total de linhas desenhadas: ${linesDrawn}`);
    });
  }

  _attachListeners() {
    if (!this.element) return;

    // Converter para jQuery se necessário
    const $element = this.element instanceof jQuery ? this.element : $(this.element);

    // Listener para adicionar domínio (apenas GM)
    $element.find(".add-domain-button").off("click").on("click", this._onAddDomain.bind(this));

    // Listener para remover domínio (apenas GM)
    $element.find(".remove-domain-button").off("click").on("click", this._onRemoveDomain.bind(this));

    // Listener para clique esquerdo (alternar desbloqueio)
    $element.find(".talent-node").off("click").on("click", (e) => {
      // Ignorar se for clique direito
      if (e.button === 2 || e.which === 3) return;
      this._onToggleNode(e);
    });

    // Listener para clique direito
    if (this.isGM) {
      // GM: menu de contexto para editar
      $element.find(".talent-node").off("contextmenu").on("contextmenu", (e) => {
        this._onNodeContextMenu(e);
      });
      
      // Também adicionar listener no wrapper para garantir
      $element.find(".talent-node-wrapper").off("contextmenu").on("contextmenu", (e) => {
        // Se o evento já foi tratado, não fazer nada
        if (e.isDefaultPrevented()) return;
        e.preventDefault();
        e.stopPropagation();
        this._onNodeContextMenu(e);
      });
    } else {
      // Jogador: clique direito para ver informações
      $element.find(".talent-node").off("contextmenu").on("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const $wrapper = $(e.currentTarget).closest(".talent-node-wrapper");
        const nodeId = $wrapper.data("node-id");
        if (!nodeId) return;
        
        const $domainSection = $wrapper.closest(".domain-section");
        const domainId = $domainSection.data("domain-id");
        if (!domainId) return;
        
        const talentTreeData = this.getTalentTreeData();
        const domain = talentTreeData.domains.find(d => d.id === domainId);
        if (!domain) return;
        
        const node = domain.nodes.find(n => n.id === nodeId);
        if (!node) return;
        
        this._showNodeInfo(node, domain);
      });
    }

    // Listener para criar árvore (apenas GM)
    $element.find(".create-tree-button").off("click").on("click", this._onCreateTree.bind(this));

    // Listener para recriar árvore (apenas GM)
    $element.find(".recreate-tree-button").off("click").on("click", this._onRecreateTree.bind(this));
    
    // Listeners para controle de nível
    $element.find(".increase-level").off("click").on("click", this._onIncreaseLevel.bind(this));
    $element.find(".decrease-level").off("click").on("click", this._onDecreaseLevel.bind(this));
  }

  async _onAddDomain(event) {
    event.preventDefault();
    if (!this.isGM) return;

    const $element = this.element instanceof jQuery ? this.element : $(this.element);
    const domainSelect = $element.find("#domain-select");
    const selectedDomainId = domainSelect.val();

    if (!selectedDomainId) {
      ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.talent-tree.select-domain`));
      return;
    }

    const talentTreeData = this.getTalentTreeData();
    const allDomains = this.getAllAvailableDomains();
    const selectedDomain = allDomains[selectedDomainId];

    if (!selectedDomain) {
      ui.notifications.error(game.i18n.localize(`${MODULE_ID}.talent-tree.domain-not-found`));
      return;
    }

    // Verificar se o domínio já foi adicionado
    if (talentTreeData.domains.find((d) => d.id === selectedDomainId)) {
      ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.talent-tree.domain-exists`));
      return;
    }

    // Obter label localizado
    const domainLabel = game.i18n.localize(selectedDomain.label) || selectedDomainId;

    // Adicionar domínio (sem nós inicialmente - o GM cria depois)
    talentTreeData.domains.push({
      id: selectedDomainId,
      label: selectedDomain.label || selectedDomainId,
      src: selectedDomain.src || "icons/svg/portal.svg",
      nodes: [], // Nós serão criados pelo botão "Criar Árvore de Talentos"
    });

    await this.saveTalentTreeData(talentTreeData);
    ui.notifications.info(
      game.i18n.format(`${MODULE_ID}.talent-tree.domain-added`, { domain: domainLabel })
    );
    domainSelect.val(""); // Limpar seleção
  }

  async _onRemoveDomain(event) {
    event.preventDefault();
    if (!this.isGM) return;

    const $element = this.element instanceof jQuery ? this.element : $(this.element);
    const domainId = $(event.currentTarget).data("domain-id");
    const talentTreeData = this.getTalentTreeData();

    talentTreeData.domains = talentTreeData.domains.filter((d) => d.id !== domainId);
    // Remover também nós desbloqueados deste domínio
    talentTreeData.unlockedNodes = talentTreeData.unlockedNodes.filter(
      (node) => !node.startsWith(`${domainId}-`)
    );

    await this.saveTalentTreeData(talentTreeData);
    ui.notifications.info(game.i18n.localize(`${MODULE_ID}.talent-tree.domain-removed`));
  }

  async _onNodeContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isGM) return;

    // Tentar encontrar o wrapper do nó
    const $target = $(event.currentTarget);
    let $wrapper = $target.closest(".talent-node-wrapper");
    
      if ($wrapper.length === 0) {
        return;
      }

    const nodeId = $wrapper.data("node-id");
    if (!nodeId) return;

    const $domainSection = $wrapper.closest(".domain-section");
    const domainId = $domainSection.data("domain-id");
    if (!domainId) return;

    // Obter dados da árvore de talentos
    const talentTreeData = this.getTalentTreeData();
    const domain = talentTreeData.domains.find(d => d.id === domainId);
    if (!domain) return;

    const node = domain.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Verificar se já existe uma carta associada a este nó
    let cardData = null;
    if (node.domainCardUuid) {
      try {
        const item = await foundry.utils.fromUuid(node.domainCardUuid);
        // Verificar se o item ainda existe e pertence ao personagem
        if (item && this.actor.items.has(item.id)) {
          cardData = item;
        } else {
          // Carta não existe mais, limpar referência
          delete node.domainCardUuid;
          await this.saveTalentTreeData(talentTreeData);
        }
      } catch (error) {
        // Carta não existe mais, limpar referência
        delete node.domainCardUuid;
        await this.saveTalentTreeData(talentTreeData);
      }
    }

    // Abrir a tela de edição/criação de carta com referência ao nó
    EditCardApplication.open(this.actor, cardData, node, domainId, this);
  }

  async _onIncreaseLevel(event) {
    event.preventDefault();
    
    // Apenas GM pode aumentar nível
    if (!this.isGM) {
      ui.notifications.warn(`Apenas o Mestre pode alterar o nível.`);
      return;
    }
    
    const talentTreeData = this.getTalentTreeData();
    
    if (talentTreeData.currentLevel < talentTreeData.maxLevel) {
      talentTreeData.currentLevel++;
      await this.saveTalentTreeData(talentTreeData);
      ui.notifications.info(`Nível aumentado para ${talentTreeData.currentLevel}/${talentTreeData.maxLevel}`);
    } else {
      ui.notifications.warn(`Você já está no nível máximo (${talentTreeData.maxLevel})`);
    }
  }

  async _onDecreaseLevel(event) {
    event.preventDefault();
    
    // Apenas GM pode diminuir nível
    if (!this.isGM) {
      ui.notifications.warn(`Apenas o Mestre pode alterar o nível.`);
      return;
    }
    
    const talentTreeData = this.getTalentTreeData();
    
    if (talentTreeData.currentLevel > 1) {
      const newLevel = talentTreeData.currentLevel - 1;
      
      // Se está voltando para o nível 1, manter apenas o primeiro nó de cada domínio
      if (newLevel === 1) {
        talentTreeData.domains.forEach(domain => {
          const firstNodeId = this.getFirstNode(domain);
          if (firstNodeId) {
            // Manter apenas o primeiro nó desbloqueado neste domínio
            const domainUnlockedNodes = talentTreeData.unlockedNodes.filter(nodeId => {
              const node = domain.nodes.find(n => n.id === nodeId);
              return node && nodeId === firstNodeId;
            });
            // Remover todos os nós deste domínio que não são o primeiro
            talentTreeData.unlockedNodes = talentTreeData.unlockedNodes.filter(nodeId => {
              const node = domain.nodes.find(n => n.id === nodeId);
              return !node || nodeId === firstNodeId;
            });
          } else {
            // Se não tem primeiro nó identificado, remover todos os nós deste domínio
            talentTreeData.unlockedNodes = talentTreeData.unlockedNodes.filter(nodeId => {
              const node = domain.nodes.find(n => n.id === nodeId);
              return !node;
            });
          }
        });
      } else {
        // Se não está voltando para nível 1, verificar quantos nós estão desbloqueados
        const unlockedCount = talentTreeData.unlockedNodes.length;
        
        // Se há mais nós desbloqueados do que o novo nível permite, bloquear os extras
        if (unlockedCount >= newLevel) {
          // Remover nós desbloqueados até que o número corresponda ao novo nível
          // IMPORTANTE: Bloquear do último para o primeiro, mas respeitando hierarquia
          const nodesToLock = unlockedCount - newLevel;
          
          // Bloquear nós respeitando a hierarquia (filhos primeiro)
          for (let i = 0; i < nodesToLock; i++) {
            // Encontrar um nó que pode ser bloqueado (sem filhos desbloqueados)
            let nodeToLock = null;
            
            // Procurar do final para o início
            for (let j = talentTreeData.unlockedNodes.length - 1; j >= 0; j--) {
              const candidateNodeId = talentTreeData.unlockedNodes[j];
              
              // Verificar se não é o primeiro nó de algum domínio
              let isFirstNode = false;
              for (const domain of talentTreeData.domains) {
                const firstNodeId = this.getFirstNode(domain);
                if (candidateNodeId === firstNodeId) {
                  isFirstNode = true;
                  break;
                }
              }
              
              if (!isFirstNode) {
                // Verificar se não tem filhos desbloqueados
                let hasUnlockedChildren = false;
                for (const domain of talentTreeData.domains) {
                  if (this.hasUnlockedChildren(candidateNodeId, domain, talentTreeData.unlockedNodes)) {
                    hasUnlockedChildren = true;
                    break;
                  }
                }
                
                if (!hasUnlockedChildren) {
                  nodeToLock = candidateNodeId;
                  break;
                }
              }
            }
            
            if (nodeToLock) {
              const index = talentTreeData.unlockedNodes.indexOf(nodeToLock);
              if (index > -1) {
                talentTreeData.unlockedNodes.splice(index, 1);
              }
            } else {
              // Se não encontrou nó para bloquear, parar
              break;
            }
          }
        }
      }
      
      talentTreeData.currentLevel = newLevel;
      await this.saveTalentTreeData(talentTreeData);
      ui.notifications.info(`Nível diminuído para ${talentTreeData.currentLevel}/${talentTreeData.maxLevel}`);
    } else {
      ui.notifications.warn(`Você já está no nível mínimo (1)`);
    }
  }

  async _onToggleNode(event) {
    event.preventDefault();
    
    const $target = $(event.currentTarget);
    const $wrapper = $target.closest(".talent-node-wrapper");
    const nodeId = $wrapper.data("node-id");

    if (!nodeId) return;

    const $domainSection = $wrapper.closest(".domain-section");
    const domainId = $domainSection.data("domain-id");
    if (!domainId) return;

    const talentTreeData = this.getTalentTreeData();
    const domain = talentTreeData.domains.find(d => d.id === domainId);
    if (!domain) return;

    const node = domain.nodes.find(n => n.id === nodeId);
    if (!node) return;
    
    // Se não é GM
    if (!this.isGM) {
      // Clique direito: mostrar informações do nó
      if (event.button === 2 || event.which === 3) {
        this._showNodeInfo(node, domain);
        return;
      }
      // Clique esquerdo: apenas permitir desbloquear (não pode bloquear)
      // A lógica de bloqueio será pulada abaixo
    } else {
      // GM: clique direito abre menu de contexto
      if (event.button === 2 || event.which === 3) {
        return; // O menu de contexto será tratado pelo _onNodeContextMenu
      }
    }

    const index = talentTreeData.unlockedNodes.indexOf(nodeId);
    const isUnlocking = index === -1; // Se não está na lista, vamos desbloquear

    if (index > -1) {
      // BLOQUEAR NÓ - Apenas GM pode bloquear
      if (!this.isGM) {
        ui.notifications.warn(
          `Apenas o Mestre pode bloquear nós. Use o botão direito do mouse para ver informações do nó.`
        );
        return;
      }
      
      // Verificar restrições
      
      // 1. Verificar se é o primeiro nó - não pode ser bloqueado (exceto quando nível volta para 1)
      const firstNodeId = this.getFirstNode(domain);
      if (nodeId === firstNodeId) {
        // Só pode bloquear o primeiro nó se o nível for 1
        if (talentTreeData.currentLevel > 1) {
          ui.notifications.warn(
            `O primeiro nó não pode ser bloqueado. Diminua o nível para 1 para resetar todos os nós.`
          );
          return;
        }
      }
      
      // 2. Verificar se o nó tem filhos desbloqueados
      if (this.hasUnlockedChildren(nodeId, domain, talentTreeData.unlockedNodes)) {
        ui.notifications.warn(
          `Este nó não pode ser bloqueado porque tem nós filhos desbloqueados. Bloqueie os nós filhos primeiro.`
        );
        return;
      }
      
      // 3. Bloquear o nó e todos os seus filhos recursivamente
      const lockedNodes = this.lockChildrenRecursively(nodeId, domain, talentTreeData.unlockedNodes);
      
      // 4. Remover o próprio nó
      talentTreeData.unlockedNodes.splice(index, 1);
      
      if (lockedNodes.length > 0) {
        ui.notifications.info(
          `Nó bloqueado. ${lockedNodes.length} nó(s) filho(s) também foram bloqueados automaticamente.`
        );
      }
    } else {
      // DESBLOQUEAR NÓ - Jogadores e GM podem desbloquear
      // Verificar se o nó está disponível para desbloqueio
      const availableNodes = this.getAvailableNodes(domain);
      
      if (!availableNodes.includes(nodeId)) {
        ui.notifications.warn(
          game.i18n.localize(`${MODULE_ID}.talent-tree.node-not-available`)
        );
        return;
      }
      
      // Verificar se há níveis disponíveis
      const unlockedCount = talentTreeData.unlockedNodes.length;
      
      if (unlockedCount >= talentTreeData.currentLevel) {
        ui.notifications.warn(
          `Você já desbloqueou todos os nós disponíveis no nível ${talentTreeData.currentLevel}. Aumente o nível para desbloquear mais nós.`
        );
        return;
      }
      
      // Desbloquear nó (adicionar à lista de desbloqueados)
      talentTreeData.unlockedNodes.push(nodeId);
      
      // Se o nó tem dados de carta salvos mas ainda não tem item criado, criar agora
      if (node.domainCardData && !node.domainCardUuid) {
        try {
          // Criar uma cópia dos dados para não modificar o original
          const itemData = foundry.utils.deepClone(node.domainCardData);
          
          // IMPORTANTE: Garantir que a descrição seja preservada
          // Se há uma descrição salva separadamente no nó, usar ela (é a mais recente)
          if (node.domainCardDescription !== undefined) {
            // A descrição pode ser string ou HTMLField (objeto com value)
            if (itemData.system && itemData.system.description) {
              // Se description é um objeto HTMLField, atualizar apenas o value
              if (typeof itemData.system.description === "object" && itemData.system.description.value !== undefined) {
                itemData.system.description.value = node.domainCardDescription;
              } else {
                // Se é string direto, substituir
                itemData.system.description = node.domainCardDescription;
              }
            } else {
              // Se não existe description no system, criar
              if (!itemData.system) {
                itemData.system = {};
              }
              itemData.system.description = node.domainCardDescription;
            }
          }
          
          // Garantir que nome e imagem também estejam atualizados (caso tenham sido modificados)
          if (node.domainCardName) {
            itemData.name = node.domainCardName;
          }
          if (node.domainCardImg) {
            itemData.img = node.domainCardImg;
          }
          
          const createdItems = await Item.create([itemData], { parent: this.actor });
          const createdItem = createdItems[0];
          
          // Associar o UUID do item criado ao nó
          node.domainCardUuid = createdItem.uuid;
          
          // Limpar dados temporários
          delete node.domainCardData;
          delete node.domainCardName;
          delete node.domainCardImg;
          delete node.domainCardDescription;
          
          ui.notifications.info(`Carta "${node.label}" adicionada ao personagem!`);
        } catch (error) {
          ui.notifications.error(`Erro ao adicionar carta ao personagem: ${error.message}`);
        }
      }
    }

    await this.saveTalentTreeData(talentTreeData);
    
    // Renderizar novamente para atualizar o estado visual dos nós
    console.log(`${MODULE_ID} | [TOGGLE NODE] Nó ${nodeId} ${isUnlocking ? 'desbloqueado' : 'bloqueado'}. Renderizando aplicação...`);
    await this.render(false);
    
    // As conexões serão redesenhadas automaticamente pelo _onRender
    console.log(`${MODULE_ID} | [TOGGLE NODE] Conexões serão redesenhadas automaticamente. Total de nós desbloqueados: ${talentTreeData.unlockedNodes.length}`);
  }
  
  async _showNodeInfo(node, domain) {
    // Obter informações da carta associada ao nó, se existir
    let cardData = null;
    let cardName = node.label;
    let cardImage = node.icon || "";
    let cardDescription = node.description || "";
    
    // Tentar carregar a carta associada
    if (node.domainCardUuid) {
      try {
        const item = await foundry.utils.fromUuid(node.domainCardUuid);
        if (item && this.actor.items.has(item.id)) {
          cardData = item;
          cardName = item.name;
          cardImage = item.img || node.icon || "";
          
          // Obter descrição da carta
          if (item.system && item.system.description) {
            if (typeof item.system.description === "object" && item.system.description.value !== undefined) {
              cardDescription = item.system.description.value;
            } else {
              cardDescription = item.system.description;
            }
          }
        }
      } catch (error) {
        // Carta não encontrada, usar dados do nó
      }
    }
    
    // Se não tem carta, usar dados do nó
    if (!cardData) {
      cardName = node.label;
      cardImage = node.icon || "";
      cardDescription = node.description || "";
    }
    
    // Preparar dados para a Application
    const nodeInfoData = {
      id: node.id,
      name: cardName,
      image: cardImage,
      description: cardDescription
    };
    
    // Abrir Application dedicada para visualização
    await NodeInfoApplication.open(nodeInfoData);
  }

  async _onCreateTree(event) {
    event.preventDefault();
    if (!this.isGM) return;

    const domainId = $(event.currentTarget).data("domain-id");
    const talentTreeData = this.getTalentTreeData();
    const domain = talentTreeData.domains.find((d) => d.id === domainId);

    if (!domain) return;

    // Criar estrutura inicial da árvore
    // Topo -> Centro -> Esquerda/Direita -> Inferiores
    domain.nodes = [
      {
        id: `${domainId}-node-1`,
        label: "Nó Inicial",
        x: 3, // Coluna central (grid de 5 colunas)
        y: 1, // Primeira linha
        icon: "fas fa-star",
        connections: [`${domainId}-node-2`],
        direction: "down"
      },
      {
        id: `${domainId}-node-2`,
        label: "Nó Central",
        x: 3, // Coluna central
        y: 2, // Segunda linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-3`, `${domainId}-node-4`, `${domainId}-node-6`],
        direction: "horizontal"
      },
      {
        id: `${domainId}-node-3`,
        label: "Nó Esquerdo",
        x: 1, // Coluna esquerda
        y: 2, // Segunda linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-7`],
        direction: "down"
      },
      {
        id: `${domainId}-node-4`,
        label: "Nó Direito",
        x: 5, // Coluna direita
        y: 2, // Segunda linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-5`],
        direction: "down"
      },
      {
        id: `${domainId}-node-5`,
        label: "Nó Inferior",
        x: 5, // Coluna direita
        y: 3, // Terceira linha
        icon: "fas fa-circle",
        connections: [],
        direction: "none"
      },
      {
        id: `${domainId}-node-6`,
        label: "Nó Central Inferior",
        x: 3, // Coluna central
        y: 3, // Terceira linha
        icon: "fas fa-circle",
        connections: [],
        direction: "none"
      },
      {
        id: `${domainId}-node-7`,
        label: "Nó Esquerdo Inferior",
        x: 1, // Coluna esquerda
        y: 3, // Terceira linha
        icon: "fas fa-circle",
        connections: [],
        direction: "none"
      }
    ];

    await this.saveTalentTreeData(talentTreeData);
    ui.notifications.info("Árvore de talentos criada!");
  }

  async _onRecreateTree(event) {
    event.preventDefault();
    if (!this.isGM) return;

    const domainId = $(event.currentTarget).data("domain-id");
    const talentTreeData = this.getTalentTreeData();
    const domain = talentTreeData.domains.find((d) => d.id === domainId);

    if (!domain) return;

    // Confirmar se o usuário quer recriar (isso vai remover todos os nós desbloqueados deste domínio)
    const confirmed = await Dialog.confirm({
      title: "Recriar Árvore de Talentos",
      content: `<p>Tem certeza que deseja recriar a árvore? Isso irá remover todos os nós existentes e desbloqueados deste domínio.</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (!confirmed) return;

    // Remover nós desbloqueados deste domínio
    talentTreeData.unlockedNodes = talentTreeData.unlockedNodes.filter(
      (node) => !node.startsWith(`${domainId}-`)
    );

    // Recriar a árvore (mesma função que criar)
    domain.nodes = [
      {
        id: `${domainId}-node-1`,
        label: "Nó Inicial",
        x: 3,
        y: 1,
        icon: "fas fa-star",
        connections: [`${domainId}-node-2`],
        direction: "down"
      },
      {
        id: `${domainId}-node-2`,
        label: "Nó Central",
        x: 3,
        y: 2,
        icon: "fas fa-circle",
        connections: [`${domainId}-node-3`, `${domainId}-node-4`, `${domainId}-node-6`],
        direction: "horizontal"
      },
      {
        id: `${domainId}-node-3`,
        label: "Nó Esquerdo",
        x: 1,
        y: 2,
        icon: "fas fa-circle",
        connections: [`${domainId}-node-7`],
        direction: "down"
      },
      {
        id: `${domainId}-node-4`,
        label: "Nó Direito",
        x: 5,
        y: 2,
        icon: "fas fa-circle",
        connections: [`${domainId}-node-5`],
        direction: "down"
      },
      {
        id: `${domainId}-node-5`,
        label: "Nó Inferior",
        x: 5,
        y: 3,
        icon: "fas fa-circle",
        connections: [],
        direction: "none"
      },
      {
        id: `${domainId}-node-6`,
        label: "Nó Central Inferior",
        x: 3,
        y: 3,
        icon: "fas fa-circle",
        connections: [],
        direction: "none"
      },
      {
        id: `${domainId}-node-7`,
        label: "Nó Esquerdo Inferior",
        x: 1,
        y: 3,
        icon: "fas fa-circle",
        connections: [],
        direction: "none"
      }
    ];

    await this.saveTalentTreeData(talentTreeData);
    ui.notifications.info("Árvore de talentos recriada!");
  }

  static async #onSubmit(event, form, formData) {
    // Implementar se necessário
  }
}

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
    this._pendingScrollPosition = null; // Para restaurar scroll após render
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
        currentLevel: 0,
        maxLevel: 11,
      };
    }
    
    // Garantir que currentLevel e maxLevel existam
    if (treeData.currentLevel === undefined) {
      treeData.currentLevel = 0;
    }
    // Atualizar maxLevel para 11 (migração de versões antigas)
    if (treeData.maxLevel === undefined || treeData.maxLevel < 11) {
      treeData.maxLevel = 11;
      // Salvar automaticamente a atualização
      if (this.actor.isOwner) {
        this.actor.setFlag(MODULE_ID, "talentTree", treeData).catch(() => {
          // Se falhar, continuar
        });
      }
    }
    
    return treeData;
  }
  
  // Calcular quais nós estão disponíveis para desbloqueio baseado nas conexões
  getAvailableNodes(domain) {
    const talentTreeData = this.getTalentTreeData();
    const availableNodes = [];
    
    // Se o nível for 0, não há nós disponíveis (apenas visualização)
    if (talentTreeData.currentLevel === 0) {
      return availableNodes;
    }
    
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
    let allDomains = {};
    if (CONFIG.DH?.DOMAIN?.allDomains) {
      allDomains = CONFIG.DH.DOMAIN.allDomains();
    }
    
    // Filtrar domínios baseado na classe do jogador
    try {
      const playerDomains = this.actor.system?.domains || [];
      
      if (Array.isArray(playerDomains) && playerDomains.length > 0) {
        // Criar um objeto filtrado contendo apenas os domínios da classe do jogador
        const filteredDomains = {};
        playerDomains.forEach(domainId => {
          if (allDomains[domainId]) {
            filteredDomains[domainId] = allDomains[domainId];
          }
        });
        
        // Se encontrou domínios filtrados, retornar apenas eles
        if (Object.keys(filteredDomains).length > 0) {
          return filteredDomains;
        }
      }
    } catch (error) {
      console.warn(`[${MODULE_ID}] Erro ao filtrar domínios por classe:`, error);
      // Se houver erro, retornar todos os domínios
    }
    
    // Se não há classe definida ou não há domínios filtrados, retornar todos
    return allDomains;
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
    
    // Restaurar posição de scroll se houver uma pendente
    if (this._pendingScrollPosition !== null) {
      const scrollPosition = this._pendingScrollPosition;
      this._pendingScrollPosition = null;
      
      // Usar múltiplos requestAnimationFrame para garantir que o DOM foi completamente atualizado
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const $windowContent = $(this.element).closest(".window-content");
          const $content = $windowContent.find(".talent-tree-content");
          
          if ($content.length > 0 && scrollPosition > 0) {
            $content.scrollTop(scrollPosition);
            console.log(`${MODULE_ID} | [ON_RENDER] Posição de scroll restaurada: ${scrollPosition}`);
          }
        });
      });
    }
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
    }
    
    // Clique direito: GM tem menu de contexto, jogador apenas visualiza
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
      
      // Se for GM, mostrar menu de contexto com opções
      if (this.isGM) {
        this._showNodeContextMenu(e, node, domain, domainId);
      } else {
        // Jogador: apenas visualizar informações
        this._showNodeInfo(node, domain);
      }
    });

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

    // Abrir tela de seleção de domínios
    try {
      const { SelectDomainApplication } = await import("./select-domain.js");
      await SelectDomainApplication.open(this);
    } catch (error) {
      ui.notifications.error(`Erro ao abrir seleção de domínios: ${error.message}`);
      console.error(`[${MODULE_ID}] Erro ao abrir seleção de domínios:`, error);
    }
  }

  async _addDomainToTree(selectedDomainId) {
    if (!this.isGM) return;

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

  async _showNodeContextMenu(event, node, domain, domainId) {
    // Remover menu anterior se existir
    const existingMenu = document.querySelector(`.${MODULE_ID}-node-context-menu`);
    if (existingMenu) {
      existingMenu.remove();
    }

    // Recarregar os dados do nó para garantir que temos os dados mais recentes
    const talentTreeData = this.getTalentTreeData();
    const currentDomain = talentTreeData.domains.find(d => d.id === domainId);
    if (currentDomain) {
      const currentNode = currentDomain.nodes.find(n => n.id === node.id);
      if (currentNode) {
        // Usar o nó atualizado em vez do nó passado como parâmetro
        node = currentNode;
        console.log(`[${MODULE_ID}] _showNodeContextMenu - Nó recarregado:`, {
          id: node.id,
          label: node.label,
          domainCardUuid: node.domainCardUuid,
          hasCard: !!node.domainCardUuid
        });
      }
    }

    // Criar menu de contexto HTML
    const menu = document.createElement("div");
    menu.className = `${MODULE_ID}-node-context-menu`;
    menu.style.cssText = `
      position: fixed;
      left: ${event.clientX}px;
      top: ${event.clientY}px;
      background: rgba(0, 0, 0, 0.9);
      border: 1px solid #666;
      border-radius: 4px;
      padding: 4px 0;
      z-index: 10000;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    `;

    // Opção 1: Ver Informações
    const viewOption = document.createElement("div");
    viewOption.className = "context-menu-item";
    viewOption.style.cssText = `
      padding: 8px 16px;
      cursor: pointer;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    viewOption.innerHTML = `<i class="fas fa-info-circle"></i> ${game.i18n.localize(`${MODULE_ID}.talent-tree.view-info`)}`;
    viewOption.addEventListener("click", async () => {
      menu.remove();
      await this._showNodeInfo(node, domain);
    });
    viewOption.addEventListener("mouseenter", () => {
      viewOption.style.background = "rgba(255, 255, 255, 0.1)";
    });
    viewOption.addEventListener("mouseleave", () => {
      viewOption.style.background = "transparent";
    });
    menu.appendChild(viewOption);

    // Opção 2: Criar/Editar Carta
    // Verificar se tem carta salva:
    // - Se tem domainCardUuid, a carta foi criada no personagem
    // - Se tem domainCardData ou domainCardName, a carta foi salva no nó (mas não criada ainda)
    const hasCard = !!(node.domainCardUuid || node.domainCardData || node.domainCardName);
    
    console.log(`[${MODULE_ID}] _showNodeContextMenu - Verificação de carta:`, {
      nodeId: node.id,
      hasDomainCardUuid: !!node.domainCardUuid,
      hasDomainCardData: !!node.domainCardData,
      hasDomainCardName: !!node.domainCardName,
      hasCard: hasCard
    });
    
    const cardOption = document.createElement("div");
    cardOption.className = "context-menu-item";
    cardOption.style.cssText = `
      padding: 8px 16px;
      cursor: pointer;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    // Mostrar "Editar Carta" se já existe carta salva (domainCardUuid, domainCardData ou domainCardName), senão "Criar Carta"
    const cardOptionText = hasCard
      ? game.i18n.localize(`${MODULE_ID}.talent-tree.edit-card`)
      : game.i18n.localize(`${MODULE_ID}.talent-tree.create-card`);
    const cardOptionIcon = hasCard ? "fas fa-edit" : "fas fa-plus";
    cardOption.innerHTML = `<i class="${cardOptionIcon}"></i> ${cardOptionText}`;
    cardOption.addEventListener("click", async () => {
      menu.remove();
      await this._onEditCard(node, domainId);
    });
    cardOption.addEventListener("mouseenter", () => {
      cardOption.style.background = "rgba(255, 255, 255, 0.1)";
    });
    cardOption.addEventListener("mouseleave", () => {
      cardOption.style.background = "transparent";
    });
    menu.appendChild(cardOption);

    // Opção 3: Excluir Carta (apenas se tiver carta associada)
    if (node.domainCardUuid) {
      const deleteOption = document.createElement("div");
      deleteOption.className = "context-menu-item";
      deleteOption.style.cssText = `
        padding: 8px 16px;
        cursor: pointer;
        color: #ff6b6b;
        display: flex;
        align-items: center;
        gap: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        margin-top: 4px;
        padding-top: 12px;
      `;
      deleteOption.innerHTML = `<i class="fas fa-trash"></i> ${game.i18n.localize(`${MODULE_ID}.talent-tree.delete-card`)}`;
      deleteOption.addEventListener("click", async () => {
        menu.remove();
        await this._onDeleteCard(node, domainId);
      });
      deleteOption.addEventListener("mouseenter", () => {
        deleteOption.style.background = "rgba(255, 107, 107, 0.2)";
      });
      deleteOption.addEventListener("mouseleave", () => {
        deleteOption.style.background = "transparent";
      });
      menu.appendChild(deleteOption);
    }

    // Adicionar ao body
    document.body.appendChild(menu);

    // Fechar menu ao clicar fora ou pressionar ESC
    const closeMenu = (e) => {
      if (!menu.contains(e.target) || e.key === "Escape") {
        menu.remove();
        document.removeEventListener("click", closeMenu);
        document.removeEventListener("keydown", closeMenu);
      }
    };

    // Aguardar um frame para não fechar imediatamente
    setTimeout(() => {
      document.addEventListener("click", closeMenu);
      document.addEventListener("keydown", closeMenu);
    }, 0);
  }

  async _onDeleteCard(node, domainId) {
    if (!this.isGM) return;
    if (!node.domainCardUuid) {
      ui.notifications.warn(
        game.i18n.localize(`${MODULE_ID}.talent-tree.no-card-to-delete`)
      );
      return;
    }

    // Confirmar exclusão
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: {
        title: game.i18n.localize(`${MODULE_ID}.talent-tree.delete-card-confirm-title`),
      },
      content: game.i18n.localize(`${MODULE_ID}.talent-tree.delete-card-confirm-text`),
    });

    if (!confirmed) return;

    try {
      // Buscar o item pelo UUID
      const item = await foundry.utils.fromUuid(node.domainCardUuid);
      let itemName = item?.name || "Carta";
      
      if (item) {
        // Verificar se o item está no personagem atual
        const actorItem = this.actor.items.get(item.id);
        
        if (actorItem) {
          // Excluir do personagem
          await this.actor.deleteEmbeddedDocuments("Item", [item.id]);
          ui.notifications.info(
            game.i18n.format(`${MODULE_ID}.talent-tree.card-deleted-from-character`, { name: itemName })
          );
        }
      }

      // Remover associação do nó
      const talentTreeData = this.getTalentTreeData();
      const domain = talentTreeData.domains.find(d => d.id === domainId);
      if (domain) {
        const nodeToUpdate = domain.nodes.find(n => n.id === node.id);
        if (nodeToUpdate) {
          delete nodeToUpdate.domainCardUuid;
          delete nodeToUpdate.domainCardData;
          delete nodeToUpdate.domainCardDescription;
          // Limpar também o label e icon se vieram da carta
          if (nodeToUpdate.label && nodeToUpdate.label === item?.name) {
            nodeToUpdate.label = nodeToUpdate.id; // Restaurar ID como label padrão
          }
          if (nodeToUpdate.icon && nodeToUpdate.icon === item?.img) {
            nodeToUpdate.icon = null; // Limpar ícone
          }
          
          await this.saveTalentTreeData(talentTreeData);
          this.render(false);
          
          ui.notifications.info(
            game.i18n.localize(`${MODULE_ID}.talent-tree.card-deleted-from-tree`)
          );
        }
      }
    } catch (error) {
      console.error(`[${MODULE_ID}] Erro ao excluir carta:`, error);
      ui.notifications.error(
        game.i18n.format(`${MODULE_ID}.talent-tree.delete-card-error`, { error: error.message })
      );
    }
  }

  async _onEditCard(node, domainId) {
    // Verificar se já existe uma carta associada a este nó
    let cardData = null;
    
    // PRIORIDADE 1: Se tem domainCardUuid, tentar carregar a carta do personagem
    if (node.domainCardUuid) {
      try {
        const item = await foundry.utils.fromUuid(node.domainCardUuid);
        // Verificar se o item ainda existe e pertence ao personagem
        if (item && this.actor.items.has(item.id)) {
          cardData = item;
        } else {
          // Carta não existe mais, limpar referência
          const talentTreeData = this.getTalentTreeData();
          const domain = talentTreeData.domains.find(d => d.id === domainId);
          if (domain) {
            const nodeToUpdate = domain.nodes.find(n => n.id === node.id);
            if (nodeToUpdate) {
              delete nodeToUpdate.domainCardUuid;
              await this.saveTalentTreeData(talentTreeData);
            }
          }
        }
      } catch (error) {
        // Carta não existe mais, limpar referência
        const talentTreeData = this.getTalentTreeData();
        const domain = talentTreeData.domains.find(d => d.id === domainId);
        if (domain) {
          const nodeToUpdate = domain.nodes.find(n => n.id === node.id);
          if (nodeToUpdate) {
            delete nodeToUpdate.domainCardUuid;
            await this.saveTalentTreeData(talentTreeData);
          }
        }
      }
    }
    
    // PRIORIDADE 2: Se não tem carta no personagem mas tem domainCardData, usar os dados salvos no nó
    if (!cardData && node.domainCardData) {
      // Criar um objeto temporário com os dados salvos para edição
      cardData = {
        name: node.domainCardName || node.label,
        img: node.domainCardImg || node.icon,
        system: foundry.utils.deepClone(node.domainCardData.system || {}),
        type: "domainCard"
      };
      // Garantir que a descrição esteja correta
      if (node.domainCardDescription) {
        if (cardData.system.description && typeof cardData.system.description === "object") {
          cardData.system.description.value = node.domainCardDescription;
        } else {
          cardData.system.description = node.domainCardDescription;
        }
      }
      // IMPORTANTE: Garantir que as actions do domainCardData sejam preservadas
      if (node.domainCardData.system?.actions) {
        if (!cardData.system.actions) {
          cardData.system.actions = {};
        }
        // Mesclar as actions do domainCardData
        if (typeof node.domainCardData.system.actions === 'object') {
          Object.assign(cardData.system.actions, foundry.utils.deepClone(node.domainCardData.system.actions));
        }
        console.log(`[${MODULE_ID}] _onEditCard - Actions carregadas do domainCardData:`, Object.keys(cardData.system.actions || {}).length);
      }
    }

    // Abrir a tela de edição/criação de carta com referência ao nó
    await EditCardApplication.open(this.actor, cardData, node, domainId, this);
  }

  async _associateCardFromCompendium(item, node, domainId) {
    try {
      const talentTreeData = this.getTalentTreeData();
      const domain = talentTreeData.domains.find(d => d.id === domainId);
      if (!domain) return;

      const nodeToUpdate = domain.nodes.find(n => n.id === node.id);
      if (!nodeToUpdate) return;

      // Criar uma cópia da carta no personagem
      const itemData = foundry.utils.deepClone(item.toObject());
      
      // Preservar effects e actions
      let effectsArray = [];
      if (item.effects) {
        if (item.effects instanceof foundry.utils.Collection || item.effects.size !== undefined) {
          effectsArray = Array.from(item.effects.values()).map(effect => {
            try {
              return effect.toObject();
            } catch (e) {
              console.error(`[${MODULE_ID}] Erro ao converter effect:`, e);
              return {
                name: effect.name,
                img: effect.img,
                description: effect.description,
                changes: effect.changes || [],
                duration: effect.duration || {},
                disabled: effect.disabled || false,
                origin: effect.origin,
                transfer: effect.transfer,
                system: effect.system || {}
              };
            }
          });
        } else if (Array.isArray(item.effects)) {
          effectsArray = foundry.utils.deepClone(item.effects);
        }
      }

      // Verificar se o nó está desbloqueado
      const isNodeUnlocked = talentTreeData.unlockedNodes.includes(node.id);

      if (isNodeUnlocked) {
        // Se o nó está desbloqueado, criar o item no personagem
        const createdItems = await Item.create([itemData], { parent: this.actor });
        const createdItem = createdItems[0];
        
        if (createdItem && effectsArray.length > 0) {
          await createdItem.createEmbeddedDocuments("ActiveEffect", effectsArray);
        }

        // Associar a carta ao nó
        nodeToUpdate.domainCardUuid = createdItem.uuid;
        nodeToUpdate.label = createdItem.name;
        nodeToUpdate.icon = createdItem.img;
        nodeToUpdate.isImage = true;

        // Obter descrição
        if (createdItem.system && createdItem.system.description) {
          if (typeof createdItem.system.description === "object" && createdItem.system.description.value !== undefined) {
            nodeToUpdate.description = createdItem.system.description.value;
          } else {
            nodeToUpdate.description = createdItem.system.description;
          }
        }

        ui.notifications.info(
          game.i18n.format(`${MODULE_ID}.talent-tree.card-added-from-compendium`, { card: createdItem.name })
        );
      } else {
        // Se o nó não está desbloqueado, salvar os dados para criar depois
        nodeToUpdate.domainCardData = itemData;
        nodeToUpdate.domainCardName = itemData.name;
        nodeToUpdate.domainCardImg = itemData.img;
        nodeToUpdate._preservedEffects = effectsArray;
        nodeToUpdate.isImage = true;

        // Obter descrição
        if (itemData.system && itemData.system.description) {
          if (typeof itemData.system.description === "object" && itemData.system.description.value !== undefined) {
            nodeToUpdate.domainCardDescription = itemData.system.description.value;
          } else {
            nodeToUpdate.domainCardDescription = itemData.system.description;
          }
        }

        ui.notifications.info(
          game.i18n.format(`${MODULE_ID}.talent-tree.card-saved-for-unlock`, { card: itemData.name })
        );
      }

      await this.saveTalentTreeData(talentTreeData);
      await this.render(false);
    } catch (error) {
      console.error(`[${MODULE_ID}] Erro ao associar carta do compendium:`, error);
      ui.notifications.error('Erro ao associar a carta ao nó.');
    }
  }

  async _onNodeContextMenu(event) {
    // Este método ainda é usado pelos listeners antigos, mas agora apenas abre as informações
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

    // Abrir informações do nó (GM também pode visualizar)
    this._showNodeInfo(node, domain);
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
      // Notificação removida conforme solicitado
    } else {
      // Notificação removida conforme solicitado
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
    
    if (talentTreeData.currentLevel > 0) {
      const newLevel = talentTreeData.currentLevel - 1;
      
      // Se está voltando para o nível 0, remover todos os nós desbloqueados
      if (newLevel === 0) {
        talentTreeData.unlockedNodes = [];
        talentTreeData.currentLevel = 0;
        await this.saveTalentTreeData(talentTreeData);
        this.render(false);
        return;
      }
      
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
      // Notificação removida conforme solicitado
    } else {
      // Notificação removida conforme solicitado
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
    
    // Clique direito: sempre mostrar informações do nó (GM e jogador, independente do estado)
    if (event.button === 2 || event.which === 3) {
      this._showNodeInfo(node, domain);
      return;
    }
    
    // Clique esquerdo: lógica de desbloquear/bloquear
    if (!this.isGM) {
      // Jogador: apenas permitir desbloquear (não pode bloquear)
      // A lógica de bloqueio será pulada abaixo
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
      
      // 1. Verificar se é o primeiro nó - não pode ser bloqueado (exceto quando nível volta para 0 ou 1)
      const firstNodeId = this.getFirstNode(domain);
      if (nodeId === firstNodeId) {
        // Só pode bloquear o primeiro nó se o nível for 0 ou 1
        if (talentTreeData.currentLevel > 1) {
          ui.notifications.warn(
            `O primeiro nó não pode ser bloqueado. Diminua o nível para 1 ou 0 para resetar todos os nós.`
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
      // Se o nível for 0, não pode desbloquear nenhum nó (apenas visualização)
      if (talentTreeData.currentLevel === 0) {
        ui.notifications.warn(
          game.i18n.localize(`${MODULE_ID}.talent-tree.cannot-unlock-at-level-zero`)
        );
        return;
      }
      
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
      
      // PRIMEIRO: Verificar se o domainCardUuid aponta para um item temporário e converter
      if (node.domainCardUuid) {
        try {
          const item = await foundry.utils.fromUuid(node.domainCardUuid);
          if (item && item.flags?.[MODULE_ID]?.isTemporaryForEditing) {
            console.log(`[${MODULE_ID}] _onToggleNode - domainCardUuid aponta para item temporário, convertendo:`, item.id);
            
            // Atualizar o item removendo a flag temporária e ajustando inVault
            await item.update({
              [`flags.${MODULE_ID}.isTemporaryForEditing`]: null,
              "system.inVault": false  // Permitir que apareça no loadout/vault
            });
            
            // Limpar dados temporários do nó
            delete node.domainCardData;
            delete node.domainCardName;
            delete node.domainCardImg;
            delete node.domainCardDescription;
            
            ui.notifications.info(`Carta "${node.label}" adicionada ao personagem!`);
          }
        } catch (e) {
          // UUID inválido ou item não encontrado, continuar
          console.warn(`[${MODULE_ID}] _onToggleNode - Erro ao verificar item por UUID:`, e);
        }
      }
      
      // SEGUNDO: Se o nó tem dados de carta salvos mas ainda não tem item criado, criar agora
      if (node.domainCardData && !node.domainCardUuid) {
        // Caso 1: Tem domainCardData mas não tem item criado - precisa criar
        try {
          // PRIMEIRO: Verificar se já existe um item temporário criado para edição
          let existingTemporaryItem = null;
          
          // Procurar por itens temporários que correspondam a este nó
          for (const item of this.actor.items) {
            if (item.type === "domainCard" && 
                item.flags?.[MODULE_ID]?.isTemporaryForEditing &&
                item.name === (node.domainCardName || node.label)) {
              existingTemporaryItem = item;
              console.log(`[${MODULE_ID}] _onToggleNode - Item temporário encontrado pelo nome:`, item.id);
              break;
            }
          }
          
          if (existingTemporaryItem) {
            // Item temporário já existe - converter em item normal removendo a flag
            console.log(`[${MODULE_ID}] _onToggleNode - Convertendo item temporário em item normal:`, existingTemporaryItem.id);
            
            // Atualizar o item removendo a flag temporária e ajustando inVault
            await existingTemporaryItem.update({
              [`flags.${MODULE_ID}.isTemporaryForEditing`]: null,
              "system.inVault": false  // Permitir que apareça no loadout/vault
            });
            
            // Associar o UUID do item existente ao nó
            node.domainCardUuid = existingTemporaryItem.uuid;
            
            // Limpar dados temporários do nó
            delete node.domainCardData;
            delete node.domainCardName;
            delete node.domainCardImg;
            delete node.domainCardDescription;
            
            ui.notifications.info(`Carta "${node.label}" adicionada ao personagem!`);
          } else {
            // Não há item temporário - criar novo item normalmente
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
            
            // Garantir que não seja criado como temporário
            if (itemData.flags?.[MODULE_ID]?.isTemporaryForEditing) {
              delete itemData.flags[MODULE_ID].isTemporaryForEditing;
            }
            if (itemData.system?.inVault === true) {
              itemData.system.inVault = false;
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
          }
        } catch (error) {
          ui.notifications.error(`Erro ao adicionar carta ao personagem: ${error.message}`);
        }
      }
    }

    await this.saveTalentTreeData(talentTreeData);
    
    // Salvar posição de scroll antes do render
    // O elemento scrollável é .talent-tree-content dentro da janela
    const $windowContent = $(this.element).closest(".window-content");
    const $content = $windowContent.find(".talent-tree-content");
    const scrollPosition = $content.length > 0 ? $content.scrollTop() : 0;
    
    console.log(`${MODULE_ID} | [TOGGLE NODE] Posição de scroll salva: ${scrollPosition}`);
    
    // Armazenar posição de scroll para restaurar no _onRender
    this._pendingScrollPosition = scrollPosition;
    
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
    let cardDescription = node.description || node.domainCardDescription || "";
    
    console.log(`[${MODULE_ID}] _showNodeInfo - Node data:`, {
      id: node.id,
      label: node.label,
      icon: node.icon,
      description: node.description,
      domainCardUuid: node.domainCardUuid,
      domainCardDescription: node.domainCardDescription,
      domainCardName: node.domainCardName,
      domainCardImg: node.domainCardImg
    });
    
    // Tentar carregar a carta associada
    if (node.domainCardUuid) {
      try {
        const item = await foundry.utils.fromUuid(node.domainCardUuid);
        console.log(`[${MODULE_ID}] _showNodeInfo - Item carregado:`, {
          id: item?.id,
          name: item?.name,
          img: item?.img,
          hasSystem: !!item?.system,
          description: item?.system?.description,
          descriptionValue: item?.system?.description?.value,
          isInActor: item ? this.actor.items.has(item.id) : false
        });
        
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
          } else if (!cardDescription) {
            // Se não tem descrição no item, usar a do nó
            cardDescription = node.description || node.domainCardDescription || "";
          }
        }
      } catch (error) {
        // Carta não encontrada, usar dados do nó
        console.warn(`[${MODULE_ID}] Erro ao carregar carta do nó:`, error);
      }
    }
    
    // Se não tem carta, usar dados do nó (com fallback para domainCardDescription)
    if (!cardData) {
      cardName = node.label || node.domainCardName || "";
      cardImage = node.icon || node.domainCardImg || "";
      cardDescription = node.description || node.domainCardDescription || "";
    }
    
    console.log(`[${MODULE_ID}] _showNodeInfo - Dados finais para exibição:`, {
      name: cardName,
      image: cardImage,
      description: cardDescription
    });
    
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

    // Criar estrutura da árvore em formato de diamante/árvore
    // Row 1: 1 nó (topo)
    // Row 2: 3 nós
    // Row 3: 3 nós (left-middle, center, right-middle)
    // Row 4: 3 nós
    // Row 5: 1 nó (fundo)
    domain.nodes = [
      // Row 1 - Nó inicial (topo)
      {
        id: `${domainId}-node-1`,
        label: "Nó Inicial",
        x: 3, // Coluna central
        y: 1, // Primeira linha
        icon: "fas fa-star",
        connections: [`${domainId}-node-2`, `${domainId}-node-3`, `${domainId}-node-4`],
        direction: "down"
      },
      // Row 2 - Três nós
      {
        id: `${domainId}-node-2`,
        label: "Nó Esquerdo",
        x: 1, // Coluna esquerda
        y: 2, // Segunda linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-5`],
        direction: "down"
      },
      {
        id: `${domainId}-node-3`,
        label: "Nó Central",
        x: 3, // Coluna central
        y: 2, // Segunda linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-6`], // Apenas para o nó central abaixo
        direction: "down"
      },
      {
        id: `${domainId}-node-4`,
        label: "Nó Direito",
        x: 5, // Coluna direita
        y: 2, // Segunda linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-7`], // Apenas para baixo
        direction: "down"
      },
      // Row 3 - Três nós (alinhados verticalmente com os nós acima) - sem conexões entre eles
      {
        id: `${domainId}-node-5`,
        label: "Nó Esquerdo Inferior",
        x: 1, // Alinhado com Nó Esquerdo (node-2)
        y: 3, // Terceira linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-8`], // Apenas para baixo
        direction: "down"
      },
      {
        id: `${domainId}-node-6`,
        label: "Nó Central",
        x: 3, // Center
        y: 3, // Terceira linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-9`], // Apenas para o nó central abaixo
        direction: "down"
      },
      {
        id: `${domainId}-node-7`,
        label: "Nó Direito Inferior",
        x: 5, // Alinhado com Nó Direito (node-4)
        y: 3, // Terceira linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-10`], // Apenas para baixo
        direction: "down"
      },
      // Row 4 - Três nós
      {
        id: `${domainId}-node-8`,
        label: "Nó Esquerdo",
        x: 1, // Coluna esquerda
        y: 4, // Quarta linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-11`],
        direction: "down"
      },
      {
        id: `${domainId}-node-9`,
        label: "Nó Central",
        x: 3, // Coluna central
        y: 4, // Quarta linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-11`],
        direction: "down"
      },
      {
        id: `${domainId}-node-10`,
        label: "Nó Direito",
        x: 5, // Coluna direita
        y: 4, // Quarta linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-11`],
        direction: "down"
      },
      // Row 5 - Nó final (fundo)
      {
        id: `${domainId}-node-11`,
        label: "Nó Final",
        x: 3, // Coluna central
        y: 5, // Quinta linha
        icon: "fas fa-star",
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

    // Recriar a árvore (mesma estrutura que criar)
    domain.nodes = [
      // Row 1 - Nó inicial (topo)
      {
        id: `${domainId}-node-1`,
        label: "Nó Inicial",
        x: 3, // Coluna central
        y: 1, // Primeira linha
        icon: "fas fa-star",
        connections: [`${domainId}-node-2`, `${domainId}-node-3`, `${domainId}-node-4`],
        direction: "down"
      },
      // Row 2 - Três nós
      {
        id: `${domainId}-node-2`,
        label: "Nó Esquerdo",
        x: 1, // Coluna esquerda
        y: 2, // Segunda linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-5`],
        direction: "down"
      },
      {
        id: `${domainId}-node-3`,
        label: "Nó Central",
        x: 3, // Coluna central
        y: 2, // Segunda linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-6`], // Apenas para o nó central abaixo
        direction: "down"
      },
      {
        id: `${domainId}-node-4`,
        label: "Nó Direito",
        x: 5, // Coluna direita
        y: 2, // Segunda linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-7`], // Apenas para baixo
        direction: "down"
      },
      // Row 3 - Três nós (alinhados verticalmente com os nós acima) - sem conexões entre eles
      {
        id: `${domainId}-node-5`,
        label: "Nó Esquerdo Inferior",
        x: 1, // Alinhado com Nó Esquerdo (node-2)
        y: 3, // Terceira linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-8`], // Apenas para baixo
        direction: "down"
      },
      {
        id: `${domainId}-node-6`,
        label: "Nó Central",
        x: 3, // Center
        y: 3, // Terceira linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-9`], // Apenas para o nó central abaixo
        direction: "down"
      },
      {
        id: `${domainId}-node-7`,
        label: "Nó Direito Inferior",
        x: 5, // Alinhado com Nó Direito (node-4)
        y: 3, // Terceira linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-10`], // Apenas para baixo
        direction: "down"
      },
      // Row 4 - Três nós
      {
        id: `${domainId}-node-8`,
        label: "Nó Esquerdo",
        x: 1, // Coluna esquerda
        y: 4, // Quarta linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-11`],
        direction: "down"
      },
      {
        id: `${domainId}-node-9`,
        label: "Nó Central",
        x: 3, // Coluna central
        y: 4, // Quarta linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-11`],
        direction: "down"
      },
      {
        id: `${domainId}-node-10`,
        label: "Nó Direito",
        x: 5, // Coluna direita
        y: 4, // Quarta linha
        icon: "fas fa-circle",
        connections: [`${domainId}-node-11`],
        direction: "down"
      },
      // Row 5 - Nó final (fundo)
      {
        id: `${domainId}-node-11`,
        label: "Nó Final",
        x: 3, // Coluna central
        y: 5, // Quinta linha
        icon: "fas fa-star",
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


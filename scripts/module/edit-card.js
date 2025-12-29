import { MODULE_ID } from "./constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class EditCardApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-edit-card`,
    tag: "div",
    window: {
      title: "Editar Carta de Domínio",
      icon: "fas fa-address-card",
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 1000,
      height: 800,
    },
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/edit-card.hbs`,
    },
  };

  constructor(actor, cardData = null, node = null, domainId = null, talentTreeApp = null, options = {}) {
    const defaultOptions = foundry.utils.mergeObject({}, EditCardApplication.DEFAULT_OPTIONS);
    defaultOptions.window.title = game.i18n.localize(`${MODULE_ID}.edit-card.title`);
    super(foundry.utils.mergeObject(defaultOptions, options));
    this.actor = actor;
    this.cardData = cardData; // Se null, é criação; se tem dados, é edição
    this.node = node; // Nó associado (se estiver criando a partir de um nó)
    this.domainId = domainId; // ID do domínio (se estiver criando a partir de um nó)
    this.talentTreeApp = talentTreeApp; // Referência à aplicação de árvore de talentos
    this.isGM = game.user.isGM;
    
    // Verificar se é uma nova carta ou edição
    // Se temos cardData com id E o item existe no personagem, é edição
    let hasExistingItem = false;
    let currentItem = null;
    
    if (cardData?.id && actor?.items) {
      currentItem = actor.items.get(cardData.id);
      hasExistingItem = currentItem && currentItem.type === "domainCard";
    }
    
    // Se não encontrou pelo cardData.id, tentar pelo domainCardUuid do nó
    if (!hasExistingItem && node?.domainCardUuid) {
      // Isso será carregado assincronamente no _onSave, mas marcamos que não é nova
      this.isNewCard = false;
    } else {
      this.isNewCard = !cardData || !hasExistingItem;
    }
    
    this.baseActions = null; // Actions da carta base (para preservar ao criar)
    this.currentItem = currentItem; // Item atual (se estiver editando um item existente)
    
    console.log(`[${MODULE_ID}] EditCardApplication constructor:`, {
      hasCardData: !!cardData,
      cardDataId: cardData?.id,
      hasExistingItem: hasExistingItem,
      isNewCard: this.isNewCard,
      hasCurrentItem: !!this.currentItem,
      nodeDomainCardUuid: node?.domainCardUuid
    });
  }

  static async open(actor, cardData = null, node = null, domainId = null, talentTreeApp = null) {
    if (!game.user.isGM) {
      ui.notifications.error(game.i18n.localize(`${MODULE_ID}.edit-card.permission-error`));
      return;
    }

    if (!actor) {
      ui.notifications.error(game.i18n.localize(`${MODULE_ID}.edit-card.no-actor`));
      return;
    }

    // Verificar se já existe uma instância aberta
    const existingApp = ui.applications ? Object.values(ui.applications).find(
      (app) => app instanceof EditCardApplication && app.actor?.id === actor.id && 
               (cardData ? app.cardData?.id === cardData.id : app.isNewCard)
    ) : null;

    if (existingApp) {
      existingApp.bringToTop();
      return;
    }

    const app = new EditCardApplication(actor, cardData, node, domainId, talentTreeApp);
    app.render(true);
    return app;
  }

  async _prepareContext(options) {
    // Pré-localizar strings
    const i18n = {
      title: game.i18n.localize(`${MODULE_ID}.edit-card.title`),
      cardName: game.i18n.localize(`${MODULE_ID}.edit-card.card-name`),
      cardImage: game.i18n.localize(`${MODULE_ID}.edit-card.card-image`),
      cardDescription: game.i18n.localize(`${MODULE_ID}.edit-card.card-description`),
      recallCost: game.i18n.localize("DAGGERHEART.ITEMS.DomainCard.recallCost") || "Recall Cost",
      save: game.i18n.localize(`${MODULE_ID}.edit-card.save`),
      cancel: game.i18n.localize(`${MODULE_ID}.edit-card.cancel`),
      dragCardHelp: game.i18n.localize(`${MODULE_ID}.edit-card.drag-card-help`),
      loadImage: game.i18n.localize(`${MODULE_ID}.edit-card.load-image`),
      browseImage: game.i18n.localize(`${MODULE_ID}.edit-card.browse-image`),
      imageUrlHelp: game.i18n.localize(`${MODULE_ID}.edit-card.image-url-help`),
    };

    // Preparar dados da carta (ou valores padrão para nova carta)
    // No Daggerheart, descrição pode estar em description.value (HTMLField) ou description direto
    let description = "";
    if (this.cardData?.system?.description) {
      if (typeof this.cardData.system.description === "string") {
        description = this.cardData.system.description;
      } else if (this.cardData.system.description.value) {
        description = this.cardData.system.description.value;
      }
    }

    // Obter recallCost do system
    let recallCost = 0;
    if (this.cardData?.system?.recallCost !== undefined) {
      recallCost = this.cardData.system.recallCost;
    }

    const cardFields = {
      name: this.cardData?.name || "",
      img: this.cardData?.img || "icons/svg/downgrade.svg",
      description: description,
      recallCost: recallCost,
    };

    // Verificar se realmente tem dados de carta (não é apenas uma nova carta vazia)
    const hasCardData = this.cardData && (this.cardData.id || this.cardData.name || this.cardData.system);

    // Preparar lista de actions para exibição
    let actionsList = [];
    
    // PRIORIDADE 1: Se temos actions em cardData.system.actions (adicionadas durante edição), usar elas
    if (this.cardData?.system?.actions && Object.keys(this.cardData.system.actions).length > 0) {
      actionsList = Object.values(this.cardData.system.actions).map(action => ({
        id: action._id || action.id || foundry.utils.randomID(),
        name: action.name || "Action",
        img: action.img || "icons/svg/downgrade.svg",
        disabled: action.disabled || false,
      }));
      console.log(`[${MODULE_ID}] _prepareContext - Actions do cardData:`, Object.keys(this.cardData.system.actions).length);
    }
    // PRIORIDADE 2: Se temos um item existente, usar suas actions
    else if (this.currentItem?.system?.actions) {
      if (this.currentItem.system.actions instanceof foundry.utils.Collection) {
        actionsList = Array.from(this.currentItem.system.actions.values()).map(action => ({
          id: action.id,
          name: action.name,
          img: action.img,
          disabled: action.disabled,
        }));
      } else if (typeof this.currentItem.system.actions === 'object' && this.currentItem.system.actions !== null) {
        // Actions como objeto
        actionsList = Object.values(this.currentItem.system.actions).map(action => ({
          id: action._id || action.id,
          name: action.name || "Action",
          img: action.img || "icons/svg/downgrade.svg",
          disabled: action.disabled || false,
        }));
      }
    } 
    // PRIORIDADE 3: Se não temos item mas temos actions preservadas, usar elas
    else if (this.baseActions) {
      actionsList = Object.values(this.baseActions).map(action => ({
        id: action._id || action.id || foundry.utils.randomID(),
        name: action.name || "Action",
        img: action.img || "icons/svg/downgrade.svg",
        disabled: action.disabled || false,
        _preserved: true, // Marcar como preservado
      }));
    }

    return {
      actor: this.actor,
      cardData: cardFields,
      hasCardData: hasCardData, // Flag para indicar se tem carta carregada
      isNewCard: this.isNewCard,
      isGM: this.isGM,
      i18n: {
        ...i18n,
        actions: game.i18n.localize("DAGGERHEART.GENERAL.Action.plural") || "Actions",
        editAction: game.i18n.localize("CONTROLS.CommonEdit") || "Editar",
        noActions: game.i18n.localize(`${MODULE_ID}.edit-card.no-actions`) || "Nenhuma action",
      },
      actions: actionsList,
      hasActions: actionsList.length > 0,
    };
  }

  async _onRender(context, options) {
    super._onRender?.(context, options);
    this._attachListeners();
    this._setupDragAndDrop();
    this._setupUpdateListener();
    
    // Se já tem dados da carta (edição), habilitar campos
    const hasCardData = this.cardData && (this.cardData.id || this.cardData.name || this.cardData.system);
    if (hasCardData) {
      this._enableFormFields();
      
      // PRIORIDADE 1: Se temos node.domainCardUuid, carregar o item do personagem
      if (!this.currentItem && this.node?.domainCardUuid) {
        try {
          const item = await foundry.utils.fromUuid(this.node.domainCardUuid);
          if (item && this.actor.items.has(item.id)) {
            this.currentItem = this.actor.items.get(item.id);
            this.cardData = this.currentItem;
            console.log(`[${MODULE_ID}] _onRender - currentItem carregado do domainCardUuid:`, this.currentItem.id);
          }
        } catch (error) {
          console.warn(`[${MODULE_ID}] _onRender - Erro ao carregar item do domainCardUuid:`, error);
        }
      }
      
      // PRIORIDADE 2: Se temos cardData.id, tentar carregar o item
      if (!this.currentItem && this.cardData?.id) {
        const item = this.actor.items.get(this.cardData.id);
        if (item) {
          this.currentItem = item;
          this.cardData = item;
          console.log(`[${MODULE_ID}] _onRender - currentItem carregado do cardData.id:`, this.currentItem.id);
        }
      }
      
      // PRIORIDADE 3: Se ainda não temos currentItem, tentar encontrar pelo nome
      if (!this.currentItem && this.cardData?.name) {
        const item = this.actor.items.find(i => i.type === "domainCard" && i.name === this.cardData.name);
        if (item) {
          this.currentItem = item;
          this.cardData = item;
          console.log(`[${MODULE_ID}] _onRender - currentItem encontrado pelo nome:`, this.currentItem.id);
        }
      }
    } else {
      // Garantir que os campos estão desabilitados
      this._disableFormFields();
    }
  }

  _setupUpdateListener() {
    // Remover listener anterior se existir
    if (this._updateItemHook) {
      Hooks.off("updateItem", this._updateItemHook);
      this._updateItemHook = null;
    }

    // Adicionar listener para atualizar a lista quando o item for atualizado
    this._updateItemHook = async (item, changes, options, userId) => {
      // Verificar se é o item que estamos editando
      if (this.currentItem && item.id === this.currentItem.id && item.parent?.id === this.actor.id) {
        console.log(`[${MODULE_ID}] Item atualizado, recarregando lista de actions`);
        // Atualizar currentItem
        this.currentItem = item;
        this.cardData = item;
        // Recarregar apenas a parte de actions do formulário
        await this.render();
      }
    };

    Hooks.on("updateItem", this._updateItemHook);
  }

  async close(options = {}) {
    // Remover listener ao fechar
    if (this._updateItemHook) {
      Hooks.off("updateItem", this._updateItemHook);
      this._updateItemHook = null;
    }
    return super.close(options);
  }

  _attachListeners() {
    if (!this.element) return;

    const $element = this.element instanceof jQuery ? this.element : $(this.element);

    // Listener para salvar (submit do form)
    $element.find(".edit-card-form").off("submit").on("submit", (e) => {
      e.preventDefault();
      this._onSave(e);
    });

    // Listener para cancelar
    $element.find(".cancel-card-button").off("click").on("click", () => {
      this.close();
    });

    // Listener de upload de arquivo removido - apenas edição via URL

    // Listener para preview de imagem via URL
    $element.find("#card-image-url").off("input").on("input", (e) => {
      const url = $(e.target).val();
      if (url) {
        $element.find("#card-image-preview").attr("src", url).on("error", function() {
          // Se a imagem falhar ao carregar, mostrar ícone padrão
          $(this).attr("src", "icons/svg/downgrade.svg");
        });
      }
    });

    // Listener para botões de editar action
    $element.find(".edit-action-button").off("click").on("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const actionId = $(e.currentTarget).data("action-id");
      await this._onEditAction(actionId);
    });

    // Listener para botão de criar action
    $element.find(".create-action-button").off("click").on("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await this._onCreateAction();
    });

    // Listener para botões de deletar action
    $element.find(".delete-action-button").off("click").on("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const actionId = $(e.currentTarget).data("action-id");
      await this._onDeleteAction(actionId);
    });

    // Listener para botão de procurar imagem (FilePicker do Foundry)
    $element.find(".browse-image-button").off("click").on("click", async (e) => {
      e.preventDefault();
      
      try {
        // Abrir o FilePicker do Foundry
        const filePicker = new FilePicker({
          type: "image",
          current: $element.find("#card-image-url").val() || "",
          callback: (path) => {
            // Quando uma imagem for selecionada, atualizar o campo e o preview
            $element.find("#card-image-url").val(path);
            const preview = $element.find("#card-image-preview");
            preview.attr("src", ""); // Limpar primeiro para forçar reload
            preview.attr("src", path).on("error", function() {
              ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.edit-card.image-load-error`));
              $(this).attr("src", "icons/svg/downgrade.svg");
            });
          },
          top: this.position?.top || 100,
          left: this.position?.left || 100,
        });
        
        await filePicker.render(true);
      } catch (error) {
        ui.notifications.error(`Erro ao abrir seletor de arquivo: ${error.message}`);
      }
    });

    // Listener de upload de arquivo removido - apenas edição via URL

    // Listener para clicar na imagem e reabrir o Compendium Browser
    // Usar mousedown/mouseup para detectar clique simples sem interferir com drag
    let mouseDownTime = 0;
    let mouseDownPos = null;
    
    $element.find("#card-image-preview, .card-drop-zone").off("mousedown").on("mousedown", (e) => {
      mouseDownTime = Date.now();
      mouseDownPos = { x: e.clientX, y: e.clientY };
    });

    $element.find("#card-image-preview, .card-drop-zone").off("mouseup").on("mouseup", async (e) => {
      // Verificar se foi um clique simples (não um drag)
      const mouseUpTime = Date.now();
      const timeDiff = mouseUpTime - mouseDownTime;
      const isClick = timeDiff < 200; // Menos de 200ms
      
      if (mouseDownPos) {
        const distance = Math.sqrt(
          Math.pow(e.clientX - mouseDownPos.x, 2) + 
          Math.pow(e.clientY - mouseDownPos.y, 2)
        );
        const isDrag = distance > 5; // Se moveu mais de 5px, é um drag
        
        if (isClick && !isDrag) {
          e.preventDefault();
          e.stopPropagation();
          await this._openCompendiumBrowser();
        }
      }
      
      mouseDownTime = 0;
      mouseDownPos = null;
    });
  }

  async _openCompendiumBrowser() {
    try {
      // Verificar se o Compendium Browser está aberto
      const compendiumBrowser = ui.compendiumBrowser;
      if (compendiumBrowser && compendiumBrowser.rendered) {
        // Se já está aberto, apenas trazer para frente
        compendiumBrowser.bringToTop();
        return;
      }

      // Preparar os presets do Compendium Browser
      const playerDomains = this.actor?.system?.domains || [];
      
      const presets = {
        folder: 'domains',
        render: {
          noFolder: true
        }
      };

      // Filtrar apenas cartas dos domínios permitidos pela classe do jogador
      if (Array.isArray(playerDomains) && playerDomains.length > 0) {
        presets.filter = {
          'system.domain': { 
            key: 'system.domain', 
            value: playerDomains 
          }
        };
      }

      // Abrir o Compendium Browser
      await compendiumBrowser.open(presets);
    } catch (error) {
      console.error(`[${MODULE_ID}] Erro ao abrir Compendium Browser:`, error);
      ui.notifications.error(`Erro ao abrir Compendium Browser: ${error.message}`);
    }
  }

  _setupDragAndDrop() {
    if (!this.element) return;

    const $element = this.element instanceof jQuery ? this.element : $(this.element);
    const dropZone = $element.find(".card-drop-zone")[0];

    if (!dropZone) return;

    // Prevenir comportamento padrão
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("drag-over");
    });

    dropZone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("drag-over");
    });

    dropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("drag-over");

      // Verificar se é um item arrastado do Foundry
      const data = e.dataTransfer?.getData("text/plain");
      if (!data) return;

      try {
        const dragData = JSON.parse(data);
        
        // Verificar se é um item do Foundry
        if (dragData.type === "Item" && dragData.uuid) {
          const item = await foundry.utils.fromUuid(dragData.uuid);
          if (item && item.type === "domainCard") {
            // Preencher o formulário com os dados do item arrastado
            this._fillFormFromItem(item);
            // Habilitar todos os campos
            this._enableFormFields();
            ui.notifications.info(
              game.i18n.format(`${MODULE_ID}.edit-card.card-loaded`, { name: item.name })
            );
            
            // Fechar o Compendium Browser automaticamente após selecionar a carta
            if (ui.compendiumBrowser && ui.compendiumBrowser.rendered) {
              ui.compendiumBrowser.close();
            }
          }
        }
      } catch (error) {
        // Erro silencioso ao processar item arrastado
      }
    });
  }

  _enableFormFields() {
    if (!this.element) return;
    const $element = this.element instanceof jQuery ? this.element : $(this.element);
    
    // Habilitar todos os campos
      $element.find("#card-name").prop("disabled", false);
      $element.find("#card-image-url").prop("disabled", false);
      $element.find("#card-description").prop("disabled", false);
      $element.find("#card-recall-cost").prop("disabled", false);
      $element.find(".browse-image-button").prop("disabled", false);
  }

  _disableFormFields() {
    if (!this.element) return;
    const $element = this.element instanceof jQuery ? this.element : $(this.element);
    
    // Desabilitar todos os campos
    $element.find("#card-name").prop("disabled", true);
    $element.find("#card-image-url").prop("disabled", true);
    $element.find("#card-description").prop("disabled", true);
    $element.find("#card-recall-cost").prop("disabled", true);
    $element.find(".browse-image-button").prop("disabled", true);
  }

  async _onEditAction(actionId) {
    console.log(`[${MODULE_ID}] _onEditAction - actionId:`, actionId);
    console.log(`[${MODULE_ID}] _onEditAction - currentItem:`, this.currentItem);
    console.log(`[${MODULE_ID}] _onEditAction - cardData:`, this.cardData);
    console.log(`[${MODULE_ID}] _onEditAction - node:`, this.node);
    console.log(`[${MODULE_ID}] _onEditAction - node.domainCardUuid:`, this.node?.domainCardUuid);
    console.log(`[${MODULE_ID}] _onEditAction - cardData.name:`, this.cardData?.name);
    
    // Se não temos currentItem mas temos domainCardUuid, tentar carregar o item
    if (!this.currentItem && this.node?.domainCardUuid) {
      try {
        const item = await foundry.utils.fromUuid(this.node.domainCardUuid);
        if (item && this.actor.items.has(item.id)) {
          this.currentItem = this.actor.items.get(item.id);
          console.log(`[${MODULE_ID}] _onEditAction - currentItem carregado do domainCardUuid:`, this.currentItem);
        }
      } catch (error) {
        console.warn(`[${MODULE_ID}] _onEditAction - Erro ao carregar item do domainCardUuid:`, error);
      }
    }
    
    // Se ainda não temos currentItem mas temos cardData.id, tentar carregar
    if (!this.currentItem && this.cardData?.id) {
      const item = this.actor.items.get(this.cardData.id);
      if (item) {
        this.currentItem = item;
        console.log(`[${MODULE_ID}] _onEditAction - currentItem carregado do cardData.id:`, this.currentItem);
      }
    }
    
    // Se temos um item existente, abrir o sheet da action
    if (this.currentItem?.system?.actions) {
      let action = null;
      
      // Tentar encontrar a action
      if (this.currentItem.system.actions instanceof foundry.utils.Collection) {
        action = this.currentItem.system.actions.get(actionId);
        console.log(`[${MODULE_ID}] _onEditAction - Action encontrada via Collection:`, action);
      } else if (typeof this.currentItem.system.actions === 'object' && this.currentItem.system.actions !== null) {
        // Tentar encontrar por _id ou id em todas as actions
        for (const [key, a] of Object.entries(this.currentItem.system.actions)) {
          const id = a._id || a.id || key;
          if (id === actionId) {
            action = a;
            console.log(`[${MODULE_ID}] _onEditAction - Action encontrada via objeto:`, action);
            break;
          }
        }
      }
      
      if (action) {
        // Actions no Daggerheart têm um sheet config através do metadata
        try {
          // Verificar se a action tem um item associado (necessário para ActionConfig)
          // action.item é um getter que retorna this.parent.parent
          // Verificar se parent.parent existe antes de tentar acessar action.item
          if (!action.parent?.parent) {
            ui.notifications.warn(
              game.i18n.localize(`${MODULE_ID}.edit-card.action-edit-after-save`) || 
              "Por favor, salve a carta primeiro antes de editar as actions."
            );
            return;
          }
          
          // Verificar se o item da action é o mesmo que currentItem
          let actionItem = null;
          try {
            actionItem = action.item;
            
            // Verificar se o item está em um compendium bloqueado
            if (actionItem?.pack) {
              const compendium = game.packs.get(actionItem.pack);
              if (compendium?.locked) {
                ui.notifications.warn(
                  game.i18n.localize(`${MODULE_ID}.edit-card.action-edit-compendium-locked`) || 
                  "Não é possível editar actions de itens em compendiums bloqueados. Por favor, salve a carta no personagem primeiro."
                );
                return;
              }
            }
            
            // Verificar se o item está em um compendium (mesmo que não bloqueado)
            if (actionItem?.pack || actionItem?.uuid?.startsWith('Compendium.')) {
              // Verificar se o item já está no personagem
              if (!this.actor.items.has(actionItem.id)) {
                ui.notifications.warn(
                  game.i18n.localize(`${MODULE_ID}.edit-card.action-edit-compendium`) || 
                  "Por favor, salve a carta no personagem primeiro antes de editar as actions."
                );
                return;
              }
              // Se está no personagem, usar o item do personagem em vez do compendium
              actionItem = this.actor.items.get(actionItem.id);
            }
            
            if (!actionItem || actionItem !== this.currentItem) {
              // Tentar acessar a action através do item para garantir que está vinculada
              const itemActions = this.currentItem.system.actions;
              if (itemActions instanceof foundry.utils.Collection) {
                action = itemActions.get(actionId);
              } else if (typeof itemActions === 'object' && itemActions !== null) {
                for (const [key, a] of Object.entries(itemActions)) {
                  const id = a._id || a.id || key;
                  if (id === actionId) {
                    action = a;
                    break;
                  }
                }
              }
              // Verificar novamente se agora tem item
              if (action.parent?.parent) {
                actionItem = action.item;
                // Verificar novamente se é de compendium
                if (actionItem?.pack || actionItem?.uuid?.startsWith('Compendium.')) {
                  if (!this.actor.items.has(actionItem.id)) {
                    ui.notifications.warn(
                      game.i18n.localize(`${MODULE_ID}.edit-card.action-edit-compendium`) || 
                      "Por favor, salve a carta no personagem primeiro antes de editar as actions."
                    );
                    return;
                  }
                  actionItem = this.actor.items.get(actionItem.id);
                }
              }
            }
          } catch (e) {
            console.warn(`[${MODULE_ID}] _onEditAction - Erro ao acessar action.item:`, e);
            ui.notifications.warn(
              game.i18n.localize(`${MODULE_ID}.edit-card.action-edit-after-save`) || 
              "Por favor, salve a carta primeiro antes de editar as actions."
            );
            return;
          }
          
          // Se ainda não tem item, tentar usar currentItem diretamente
          if (!actionItem) {
            actionItem = this.currentItem;
          }
          
          // Se ainda não tem item, avisar que precisa salvar primeiro
          if (!actionItem) {
            ui.notifications.warn(
              game.i18n.localize(`${MODULE_ID}.edit-card.action-edit-after-save`) || 
              "Por favor, salve a carta primeiro antes de editar as actions."
            );
            return;
          }
          
          // IMPORTANTE: Garantir que a action está vinculada ao item correto
          // Se a action não tem parent válido OU o parent não é o item correto, recarregar do item
          if (!action.parent?.parent || (action.item && action.item !== actionItem)) {
            console.log(`[${MODULE_ID}] _onEditAction - Recarregando action do item:`, actionItem.id);
            // Recarregar a action do item atualizado
            const itemActions = actionItem.system.actions;
            if (itemActions instanceof foundry.utils.Collection) {
              action = itemActions.get(actionId);
            } else if (typeof itemActions === 'object' && itemActions !== null) {
              for (const [key, a] of Object.entries(itemActions)) {
                const id = a._id || a.id || key;
                if (id === actionId) {
                  action = a;
                  break;
                }
              }
            }
            
            // Se ainda não encontrou, avisar
            if (!action) {
              ui.notifications.warn(
                "Não foi possível encontrar a action no item. Por favor, recarregue a janela."
              );
              return;
            }
            
            // Verificar novamente se tem parent válido após recarregar
            if (!action.parent?.parent) {
              ui.notifications.warn(
                "A action não está vinculada corretamente ao item. Por favor, recarregue a janela."
              );
              return;
            }
          }
          
          // Tentar acessar o sheet diretamente
          if (action.sheet) {
            console.log(`[${MODULE_ID}] _onEditAction - Abrindo sheet da action`);
            action.sheet.render(true);
            return;
          }
          
          // Se não tem sheet, tentar criar usando o ActionConfig
          const ActionConfig = game.system.api?.applications?.sheetsConfigs?.ActionConfig;
          if (ActionConfig) {
            console.log(`[${MODULE_ID}] _onEditAction - Criando ActionConfig`);
            const config = new ActionConfig(action);
            config.render(true);
            return;
          }
          
          // Última tentativa: usar o sheetClass do metadata
          const sheetClass = action.constructor?.metadata?.sheetClass;
          if (sheetClass) {
            console.log(`[${MODULE_ID}] _onEditAction - Usando sheetClass do metadata`);
            const config = new sheetClass(action);
            config.render(true);
            return;
          }
        } catch (error) {
          console.error(`[${MODULE_ID}] Erro ao abrir sheet da action:`, error);
          ui.notifications.error(`Erro ao abrir editor de action: ${error.message}`);
          return;
        }
      } else {
        console.warn(`[${MODULE_ID}] _onEditAction - Action não encontrada com id:`, actionId);
        ui.notifications.warn(
          `Action não encontrada com id: ${actionId}. Por favor, recarregue a janela.`
        );
        return;
      }
    } else {
      // Não temos currentItem - tentar carregar novamente antes de desistir
      console.warn(`[${MODULE_ID}] _onEditAction - Não temos currentItem. Tentando carregar novamente...`);
      
      // PRIORIDADE 1: Tentar carregar do domainCardUuid
      if (this.node?.domainCardUuid) {
        try {
          const item = await foundry.utils.fromUuid(this.node.domainCardUuid);
          if (item && this.actor.items.has(item.id)) {
            this.currentItem = this.actor.items.get(item.id);
            console.log(`[${MODULE_ID}] _onEditAction - currentItem carregado do domainCardUuid:`, this.currentItem.id);
            // Tentar novamente com o currentItem carregado
            return this._onEditAction(actionId);
          }
        } catch (error) {
          console.warn(`[${MODULE_ID}] _onEditAction - Erro ao carregar item do domainCardUuid:`, error);
        }
      }
      
      // PRIORIDADE 2: Tentar encontrar pelo nome da carta
      if (this.cardData?.name) {
        console.log(`[${MODULE_ID}] _onEditAction - Tentando encontrar item pelo nome:`, this.cardData.name);
        const item = this.actor.items.find(i => i.type === "domainCard" && i.name === this.cardData.name);
        console.log(`[${MODULE_ID}] _onEditAction - Item encontrado pelo nome:`, item);
        if (item) {
          this.currentItem = item;
          this.cardData = item;
          console.log(`[${MODULE_ID}] _onEditAction - currentItem encontrado pelo nome:`, this.currentItem.id);
          // Tentar novamente com o currentItem carregado
          return this._onEditAction(actionId);
        } else {
          console.warn(`[${MODULE_ID}] _onEditAction - Nenhum item encontrado com o nome:`, this.cardData.name);
          console.log(`[${MODULE_ID}] _onEditAction - Itens disponíveis no actor:`, this.actor.items.map(i => ({ id: i.id, name: i.name, type: i.type })));
          
          // Se temos node.domainCardData mas não temos item no personagem, a carta está salva apenas no nó
          // Nesse caso, precisamos criar o item temporariamente ou avisar que precisa desbloquear o nó
          if (this.node?.domainCardData && this.talentTreeApp) {
            const talentTreeData = this.talentTreeApp.getTalentTreeData();
            const isNodeUnlocked = talentTreeData.unlockedNodes.includes(this.node.id);
            
            console.log(`[${MODULE_ID}] _onEditAction - Verificando nó:`, {
              nodeId: this.node.id,
              isNodeUnlocked: isNodeUnlocked,
              hasDomainCardData: !!this.node.domainCardData,
              domainCardUuid: this.node.domainCardUuid
            });
            
            // Permitir editar actions mesmo se o nó não estiver desbloqueado
            // Criar o item temporariamente apenas para edição
            if (!isNodeUnlocked) {
              console.log(`[${MODULE_ID}] _onEditAction - Nó não está desbloqueado, mas criando item temporariamente para edição...`);
            }
            
            // Criar o item a partir do domainCardData (mesmo se o nó não estiver desbloqueado)
            // Isso permite editar actions mesmo quando o nó não está desbloqueado
            try {
                console.log(`[${MODULE_ID}] _onEditAction - Criando item a partir do domainCardData...`);
                const itemData = foundry.utils.deepClone(this.node.domainCardData);
                itemData.name = this.node.domainCardName || this.cardData.name;
                itemData.img = this.node.domainCardImg || this.cardData.img;
                
                // Garantir que o tipo está correto
                if (!itemData.type) {
                  itemData.type = "domainCard";
                }
                
                // Garantir que o system.domain está correto (usar o domainId se disponível)
                if (!itemData.system) {
                  itemData.system = {};
                }
                if (!itemData.system.domain && this.domainId) {
                  itemData.system.domain = this.domainId;
                }
                
                // IMPORTANTE: Quando criamos o item temporariamente para edição (nó não desbloqueado),
                // NÃO adicionar ao loadout nem ao vault. O item só deve aparecer quando o nó for desbloqueado.
                // Usar uma flag customizada para marcar que é temporário e filtrar depois
                if (!isNodeUnlocked) {
                  // Marcar como temporário usando uma flag customizada
                  if (!itemData.flags) {
                    itemData.flags = {};
                  }
                  if (!itemData.flags[MODULE_ID]) {
                    itemData.flags[MODULE_ID] = {};
                  }
                  itemData.flags[MODULE_ID].isTemporaryForEditing = true;
                  // Definir inVault como true para que não apareça no loadout
                  // Mas vamos filtrar esses itens temporários para que não apareçam no vault também
                  itemData.system.inVault = true;
                  console.log(`[${MODULE_ID}] _onEditAction - Item será criado como temporário (não vai para loadout nem vault)`);
                }
                
                console.log(`[${MODULE_ID}] _onEditAction - ItemData para criar:`, {
                  name: itemData.name,
                  type: itemData.type,
                  domain: itemData.system?.domain,
                  inVault: itemData.system?.inVault,
                  hasActions: !!itemData.system?.actions,
                  actionsCount: itemData.system?.actions ? Object.keys(itemData.system.actions).length : 0
                });
                
                const createdItems = await Item.create([itemData], { parent: this.actor });
                const createdItem = createdItems[0];
                if (createdItem) {
                  // Verificar se a flag foi salva corretamente
                  const hasFlag = createdItem.flags?.[MODULE_ID]?.isTemporaryForEditing;
                  console.log(`[${MODULE_ID}] _onEditAction - Item criado:`, {
                    id: createdItem.id,
                    name: createdItem.name,
                    hasTemporaryFlag: hasFlag,
                    flags: createdItem.flags
                  });
                  
                  this.currentItem = createdItem;
                  this.cardData = createdItem;
                  // Associar ao nó
                  await this._associateCardToNode(createdItem);
                  console.log(`[${MODULE_ID}] _onEditAction - Item criado a partir do domainCardData:`, this.currentItem.id);
                  // Tentar novamente com o currentItem carregado
                  return this._onEditAction(actionId);
                } else {
                  console.error(`[${MODULE_ID}] _onEditAction - Item não foi criado`);
                  ui.notifications.error("Não foi possível criar o item no personagem.");
                  return;
                }
              } catch (error) {
                console.error(`[${MODULE_ID}] _onEditAction - Erro ao criar item:`, error);
                ui.notifications.error(`Erro ao criar item: ${error.message}`);
                return;
              }
            }
          }
        }
      
      // PRIORIDADE 3: Tentar encontrar pelo cardData.id se existir
      if (this.cardData?.id) {
        const item = this.actor.items.get(this.cardData.id);
        if (item) {
          this.currentItem = item;
          this.cardData = item;
          console.log(`[${MODULE_ID}] _onEditAction - currentItem encontrado pelo id:`, this.currentItem.id);
          // Tentar novamente com o currentItem carregado
          return this._onEditAction(actionId);
        }
      }
      
      // Se ainda não temos currentItem, avisar
      ui.notifications.warn(
        game.i18n.localize(`${MODULE_ID}.edit-card.action-edit-after-save`) || 
        "Por favor, salve a carta primeiro antes de editar as actions."
      );
      return;
    }
    
    // Se não temos item ainda, mas temos action preservada, avisar que precisa salvar primeiro
    if (this.baseActions) {
      const actionData = Object.values(this.baseActions).find(a => {
        const id = a._id || a.id || foundry.utils.randomID();
        return id === actionId;
      });
      if (actionData) {
        ui.notifications.warn(
          game.i18n.localize(`${MODULE_ID}.edit-card.action-edit-after-save`) || 
          "As actions só podem ser editadas após salvar a carta."
        );
        return;
      }
    }
    
    ui.notifications.warn(
      game.i18n.localize(`${MODULE_ID}.edit-card.action-not-found`) || 
      "Action não encontrada. Certifique-se de que a carta foi salva primeiro."
    );
  }

  async _onCreateAction() {
    console.log(`[${MODULE_ID}] _onCreateAction - Iniciando criação de action`);
    
    // Se temos currentItem, criar action normalmente
    if (this.currentItem) {
      try {
        // Usar o método Action.create do sistema Daggerheart
        const ActionClass = game.system.api?.models?.actions?.actionsTypes?.base;
        if (!ActionClass) {
          ui.notifications.error("Não foi possível encontrar a classe de Action do sistema.");
          return;
        }

        // O parent deve ser o system do item (this.currentItem.system)
        const newAction = await ActionClass.create({}, {
          parent: this.currentItem.system,
          renderSheet: true
        });

        if (newAction) {
          console.log(`[${MODULE_ID}] _onCreateAction - Action criada:`, newAction.id);
          // Recarregar a lista de actions atualizando o formulário
          await this.render();
          ui.notifications.info(
            game.i18n.format(`${MODULE_ID}.edit-card.action-created`, { name: newAction.name }) ||
            `Action "${newAction.name}" criada com sucesso!`
          );
        }
      } catch (error) {
        console.error(`[${MODULE_ID}] Erro ao criar action:`, error);
        ui.notifications.error(`Erro ao criar action: ${error.message}`);
      }
      return;
    }

    // Se não temos currentItem, criar action temporariamente nos dados do cardData
    if (!this.cardData) {
      ui.notifications.warn(
        game.i18n.localize(`${MODULE_ID}.edit-card.action-create-after-save`) || 
        "Por favor, salve a carta primeiro antes de criar actions."
      );
      return;
    }

    // Garantir que cardData.system existe
    if (!this.cardData.system) {
      this.cardData.system = {};
    }
    if (!this.cardData.system.actions) {
      this.cardData.system.actions = {};
    }

    try {
      // Primeiro, pedir ao usuário para selecionar o tipo de action
      const actionTypeResult = await foundry.applications.api.DialogV2.input({
        window: { title: game.i18n.localize('DAGGERHEART.CONFIG.SelectAction.selectType') },
        position: { width: 300 },
        classes: ['daggerheart', 'dh-style'],
        content: await foundry.applications.handlebars.renderTemplate(
          'systems/daggerheart/templates/actionTypes/actionType.hbs',
          {
            types: CONFIG.DH.ACTIONS.actionTypes,
            itemName: this.cardData.name || "Carta"
          }
        ),
        ok: {
          label: game.i18n.format('DOCUMENT.Create', {
            type: game.i18n.localize('DAGGERHEART.GENERAL.Action.single')
          })
        }
      });

      if (!actionTypeResult || !actionTypeResult.type) {
        return; // Usuário cancelou
      }

      const ActionClass = game.system.api?.models?.actions?.actionsTypes[actionTypeResult.type];
      if (!ActionClass) {
        ui.notifications.error("Tipo de action não encontrado.");
        return;
      }

      // Criar uma action temporária com estrutura básica
      const actionId = foundry.utils.randomID();
      
      // Obter configuração padrão (pode não ter parent, então usar valores padrão)
      let sourceConfig = {};
      try {
        if (ActionClass.getSourceConfig) {
          // Tentar obter config padrão, mas pode falhar sem parent
          sourceConfig = ActionClass.getSourceConfig(null) || {};
        }
      } catch (e) {
        // Se falhar, usar estrutura básica
        sourceConfig = {
          type: actionTypeResult.type,
          name: game.i18n.localize(CONFIG.DH.ACTIONS.actionTypes[actionTypeResult.type]?.name) || "Action"
        };
      }

      // Criar objeto de action básico
      const actionData = {
        _id: actionId,
        type: actionTypeResult.type,
        name: sourceConfig.name || game.i18n.localize(CONFIG.DH.ACTIONS.actionTypes[actionTypeResult.type]?.name) || "Action",
        ...sourceConfig
      };
      
      // Adicionar aos dados do cardData
      this.cardData.system.actions[actionId] = actionData;
      
      // Se temos node.domainCardData, atualizar também
      if (this.node?.domainCardData) {
        if (!this.node.domainCardData.system) {
          this.node.domainCardData.system = {};
        }
        if (!this.node.domainCardData.system.actions) {
          this.node.domainCardData.system.actions = {};
        }
        this.node.domainCardData.system.actions[actionId] = foundry.utils.deepClone(actionData);
      }

      console.log(`[${MODULE_ID}] _onCreateAction - Action criada temporariamente:`, actionId);
      
      // Recarregar a lista de actions atualizando o formulário
      await this.render();
      
      ui.notifications.info(
        game.i18n.format(`${MODULE_ID}.edit-card.action-created`, { name: actionData.name }) ||
        `Action "${actionData.name}" criada com sucesso!`
      );
    } catch (error) {
      console.error(`[${MODULE_ID}] Erro ao criar action:`, error);
      ui.notifications.error(`Erro ao criar action: ${error.message}`);
    }
  }

  async _onDeleteAction(actionId) {
    console.log(`[${MODULE_ID}] _onDeleteAction - actionId:`, actionId);
    
    // Se temos currentItem, deletar normalmente
    if (this.currentItem) {
      try {
        // Encontrar a action
        let action = null;
        if (this.currentItem.system.actions instanceof foundry.utils.Collection) {
          action = this.currentItem.system.actions.get(actionId);
        } else if (typeof this.currentItem.system.actions === 'object' && this.currentItem.system.actions !== null) {
          for (const [key, a] of Object.entries(this.currentItem.system.actions)) {
            const id = a._id || a.id || key;
            if (id === actionId) {
              action = a;
              break;
            }
          }
        }

        if (!action) {
          ui.notifications.warn(`Action não encontrada com id: ${actionId}`);
          return;
        }

        // Confirmar deleção
        const actionName = action.name || "Action";
        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: {
            title: game.i18n.format('DAGGERHEART.APPLICATIONS.DeleteConfirmation.title', {
              type: game.i18n.localize(`DAGGERHEART.GENERAL.Action.single`),
              name: actionName
            }) || `Deletar Action`,
            content: game.i18n.format('DAGGERHEART.APPLICATIONS.DeleteConfirmation.text', {
              name: actionName
            }) || `Tem certeza que deseja deletar "${actionName}"?`
          }
        });

        if (!confirmed) {
          console.log(`[${MODULE_ID}] _onDeleteAction - Deleção cancelada pelo usuário`);
          return;
        }

        // Deletar a action usando o método delete()
        await action.delete();
        
        console.log(`[${MODULE_ID}] _onDeleteAction - Action deletada:`, actionId);
        
        // Recarregar a lista de actions atualizando o formulário
        await this.render();
      
        ui.notifications.info(
          game.i18n.format(`${MODULE_ID}.edit-card.action-deleted`, { name: actionName }) ||
          `Action "${actionName}" deletada com sucesso!`
        );
      } catch (error) {
        console.error(`[${MODULE_ID}] Erro ao deletar action:`, error);
        ui.notifications.error(`Erro ao deletar action: ${error.message}`);
      }
      return;
    }

    // Se não temos currentItem mas temos cardData, deletar dos dados temporários
    if (!this.cardData) {
      ui.notifications.warn(
        game.i18n.localize(`${MODULE_ID}.edit-card.action-delete-after-save`) || 
        "Por favor, salve a carta primeiro antes de deletar actions."
      );
      return;
    }

    // Garantir que cardData.system.actions existe
    if (!this.cardData.system) {
      this.cardData.system = {};
    }
    if (!this.cardData.system.actions) {
      this.cardData.system.actions = {};
    }

    // Encontrar a action nos dados temporários
    let actionData = null;
    let actionKey = null;
    for (const [key, a] of Object.entries(this.cardData.system.actions)) {
      const id = a._id || a.id || key;
      if (id === actionId) {
        actionData = a;
        actionKey = key;
        break;
      }
    }

    if (!actionData) {
      ui.notifications.warn(`Action não encontrada com id: ${actionId}`);
      return;
    }

    // Confirmar deleção
    const actionName = actionData.name || "Action";
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: {
        title: game.i18n.format('DAGGERHEART.APPLICATIONS.DeleteConfirmation.title', {
          type: game.i18n.localize(`DAGGERHEART.GENERAL.Action.single`),
          name: actionName
        }) || `Deletar Action`,
        content: game.i18n.format('DAGGERHEART.APPLICATIONS.DeleteConfirmation.text', {
          name: actionName
        }) || `Tem certeza que deseja deletar "${actionName}"?`
      }
    });

    if (!confirmed) {
      console.log(`[${MODULE_ID}] _onDeleteAction - Deleção cancelada pelo usuário`);
      return;
    }

    // Deletar dos dados temporários
    delete this.cardData.system.actions[actionKey];
    
    // Se temos node.domainCardData, deletar também de lá
    if (this.node?.domainCardData?.system?.actions) {
      delete this.node.domainCardData.system.actions[actionKey];
    }

    console.log(`[${MODULE_ID}] _onDeleteAction - Action deletada dos dados temporários:`, actionId);
    
    // Recarregar a lista de actions atualizando o formulário
    await this.render();
    
    ui.notifications.info(
      game.i18n.format(`${MODULE_ID}.edit-card.action-deleted`, { name: actionName }) ||
      `Action "${actionName}" deletada com sucesso!`
    );
  }

  _fillFormFromItem(item) {
    if (!this.element) return;

    const $element = this.element instanceof jQuery ? this.element : $(this.element);
    
    // Preencher campos do formulário
    $element.find("#card-name").val(item.name || "");
    $element.find("#card-image-url").val(item.img || "");
    $element.find("#card-image-preview").attr("src", item.img || "icons/svg/downgrade.svg");
    
    // Preencher descrição e ação
    if (item.system) {
      // Descrição pode estar em description.value (HTMLField) ou description direto
      let description = "";
      if (item.system.description) {
        if (typeof item.system.description === "string") {
          description = item.system.description;
        } else if (item.system.description.value) {
          description = item.system.description.value;
        }
      }
      $element.find("#card-description").val(description);
      
      // Preencher recallCost
      const recallCost = item.system.recallCost !== undefined ? item.system.recallCost : 0;
      $element.find("#card-recall-cost").val(recallCost);
      
      // Preservar actions da carta base
      if (item.system.actions) {
        // Actions podem ser um objeto ou Collection
        if (item.system.actions instanceof foundry.utils.Collection) {
          // Converter Collection para objeto
          const actionsObj = {};
          for (const [key, action] of item.system.actions.entries()) {
            actionsObj[key] = foundry.utils.deepClone(action.toObject());
          }
          this.baseActions = actionsObj;
        } else if (typeof item.system.actions === 'object' && item.system.actions !== null) {
          // Já é um objeto, clonar profundamente
          this.baseActions = foundry.utils.deepClone(item.system.actions);
        }
        console.log(`[${MODULE_ID}] _fillFormFromItem - Actions preservadas:`, Object.keys(this.baseActions || {}).length);
      }
    }

    // Atualizar referência da carta para edição
    this.cardData = item;
    this.currentItem = item; // Guardar referência ao item se existir
    this.isNewCard = false;
    
    // Re-renderizar para atualizar a lista de efeitos
    this.render(false);
  }

  async _onSave(event) {
    event.preventDefault();
    if (!this.isGM) return;

    const $element = this.element instanceof jQuery ? this.element : $(this.element);
    const form = $element.find(".edit-card-form")[0];
    if (!form) return;

    const formData = new FormData(form);
    
    // Obter dados do formulário
    const name = formData.get("name") || "Carta sem Nome";
    const img = formData.get("img") || "icons/svg/downgrade.svg";
    
    // IMPORTANTE: Pegar descrição do textarea diretamente via jQuery para garantir que pegamos o valor correto
    // O FormData pode não capturar corretamente o conteúdo do textarea em alguns casos
    const descriptionTextarea = $element.find("#card-description");
    const description = descriptionTextarea.val() || "";
    
    // Pegar recallCost do formulário
    const recallCost = parseInt($element.find("#card-recall-cost").val()) || 0;

    try {
      // PRIORIDADE 1: Verificar se temos uma carta associada ao nó através do domainCardUuid
      // Se há domainCardUuid, SEMPRE tentar carregar e atualizar essa carta
      if (this.node?.domainCardUuid) {
        try {
          const itemFromNode = await foundry.utils.fromUuid(this.node.domainCardUuid);
          // Verificar se o item pertence ao personagem
          if (itemFromNode && this.actor.items.has(itemFromNode.id)) {
            // Se temos um item do nó que está no personagem, usar ele para atualização
            this.cardData = itemFromNode;
            this.currentItem = itemFromNode;
            this.isNewCard = false;
            console.log(`[${MODULE_ID}] _onSave - Item carregado do nó (domainCardUuid):`, itemFromNode.id, itemFromNode.name);
          } else {
            console.warn(`[${MODULE_ID}] _onSave - Item do nó não está no personagem:`, itemFromNode?.id);
          }
        } catch (error) {
          console.warn(`[${MODULE_ID}] _onSave - Erro ao carregar item do nó:`, error);
        }
      }
      
      // PRIORIDADE 2: Se não temos currentItem mas temos cardData com id, tentar carregar
      if (!this.currentItem && this.cardData?.id) {
        const itemById = this.actor.items.get(this.cardData.id);
        if (itemById && itemById.type === "domainCard") {
          this.currentItem = itemById;
          this.cardData = itemById; // Atualizar cardData com o item do personagem
          this.isNewCard = false;
          console.log(`[${MODULE_ID}] _onSave - Item encontrado pelo ID:`, itemById.id, itemById.name);
        }
      }
      
      // Verificar se o item existe no personagem e pode ser atualizado
      // Priorizar currentItem se disponível, senão tentar pelo cardData.id
      let existingItem = this.currentItem;
      if (!existingItem && this.cardData?.id) {
        existingItem = this.actor.items.get(this.cardData.id);
      }
      
      // Se ainda não encontrou e temos domainCardUuid, tentar carregar diretamente
      if (!existingItem && this.node?.domainCardUuid) {
        try {
          const itemFromUuid = await foundry.utils.fromUuid(this.node.domainCardUuid);
          if (itemFromUuid && this.actor.items.has(itemFromUuid.id)) {
            existingItem = itemFromUuid;
            this.cardData = itemFromUuid;
            this.currentItem = itemFromUuid;
            this.isNewCard = false;
            console.log(`[${MODULE_ID}] _onSave - Item encontrado via domainCardUuid:`, existingItem.id, existingItem.name);
          }
        } catch (error) {
          console.warn(`[${MODULE_ID}] Erro ao carregar item via domainCardUuid:`, error);
        }
      }
      
      const canUpdate = existingItem && existingItem.type === "domainCard";
      
      console.log(`[${MODULE_ID}] _onSave - Verificação:`, {
        isNewCard: this.isNewCard,
        hasCardData: !!this.cardData,
        cardDataId: this.cardData?.id,
        hasCurrentItem: !!this.currentItem,
        hasExistingItem: !!existingItem,
        existingItemId: existingItem?.id,
        existingItemName: existingItem?.name,
        canUpdate: canUpdate,
        nodeDomainCardUuid: this.node?.domainCardUuid
      });
      
      // Verificar se é um item de compendium (não pode atualizar, precisa criar novo)
      const isCompendiumItem = this.cardData?.pack !== undefined || 
                                this.cardData?.collection?.metadata?.packageName !== undefined ||
                                (this.cardData?.id && !canUpdate);
      
      // Se temos uma carta associada ao nó (domainCardUuid) E existingItem, SEMPRE atualizar
      const hasNodeCard = !!this.node?.domainCardUuid;
      
      // Decidir se deve criar ou atualizar
      // REGRA: Se temos domainCardUuid E existingItem, SEMPRE atualizar (não criar nova)
      const shouldUpdate = (hasNodeCard && existingItem && canUpdate) || (canUpdate && !isCompendiumItem);
      const shouldCreate = !shouldUpdate && ((this.isNewCard && !hasNodeCard) || !this.cardData?.id || isCompendiumItem || (!canUpdate && !hasNodeCard));
      
      console.log(`[${MODULE_ID}] _onSave - Decisão:`, {
        shouldUpdate: shouldUpdate,
        shouldCreate: shouldCreate,
        hasNodeCard: hasNodeCard,
        hasExistingItem: !!existingItem,
        canUpdate: canUpdate
      });
      
      if (shouldCreate) {
        // Criar novo item (sempre criar se for novo, de compendium, ou não estiver no personagem)
        const baseSystem = this.cardData?.system || {};
        
        // Preparar descrição - pode ser string ou HTMLField
        let descriptionData = description;
        // Se o sistema original tinha description como objeto HTMLField, manter a estrutura
        if (baseSystem.description && typeof baseSystem.description === "object" && baseSystem.description.value !== undefined) {
          descriptionData = foundry.utils.mergeObject(baseSystem.description, { value: description }, { inplace: false });
        }
        
        // Preparar dados do item com campos obrigatórios do domainCard
        // IMPORTANTE: Mesclar baseSystem primeiro, depois sobrescrever com os valores editados
        // Clonar baseSystem para não modificar o original
        const clonedBaseSystem = foundry.utils.deepClone(baseSystem);
        const systemData = foundry.utils.mergeObject(
          clonedBaseSystem,
          {
            domain: baseSystem.domain || CONFIG.DH?.DOMAIN?.domains?.arcana?.id || "arcana",
            level: baseSystem.level || 1,
            recallCost: recallCost,
            type: baseSystem.type || CONFIG.DH?.DOMAIN?.cardTypes?.ability?.id || "ability",
            inVault: baseSystem.inVault || false,
          },
          { inplace: false, insertKeys: true } // Inserir campos extras
        );
        
        // SEMPRE sobrescrever a descrição com a editada (forçar após o merge)
        systemData.description = descriptionData;
        
          // Garantir que as actions sejam preservadas explicitamente
          // PRIORIDADE 1: Se temos actions em cardData.system.actions (adicionadas durante edição), usar elas
          if (this.cardData?.system?.actions && Object.keys(this.cardData.system.actions).length > 0) {
            systemData.actions = foundry.utils.deepClone(this.cardData.system.actions);
            console.log(`[${MODULE_ID}] _onSave - Actions do cardData incluídas:`, Object.keys(systemData.actions).length);
          } 
          // PRIORIDADE 2: Se não, usar baseActions (actions preservadas da carta original)
          else if (this.baseActions) {
            // Clonar profundamente as actions preservadas
            systemData.actions = foundry.utils.deepClone(this.baseActions);
            console.log(`[${MODULE_ID}] _onSave - Actions preservadas incluídas:`, Object.keys(systemData.actions).length);
          } 
          // PRIORIDADE 3: Se não, usar do baseSystem
          else if (baseSystem.actions) {
            // Se não temos baseActions mas baseSystem tem, usar do baseSystem
            if (baseSystem.actions instanceof foundry.utils.Collection) {
              // Converter Collection para objeto
              const actionsObj = {};
              for (const [key, action] of baseSystem.actions.entries()) {
                actionsObj[key] = foundry.utils.deepClone(action.toObject());
              }
              systemData.actions = actionsObj;
            } else if (typeof baseSystem.actions === 'object' && baseSystem.actions !== null) {
              // Já é um objeto, clonar profundamente
              systemData.actions = foundry.utils.deepClone(baseSystem.actions);
            }
            console.log(`[${MODULE_ID}] _onSave - Actions do baseSystem incluídas:`, Object.keys(systemData.actions || {}).length);
          }
        
        // Log para debug - verificar se actions estão em systemData
        console.log(`[${MODULE_ID}] _onSave (shouldCreate) - systemData.actions antes de criar itemData:`, {
          hasActions: !!systemData.actions,
          actionsCount: systemData.actions ? Object.keys(systemData.actions).length : 0,
          actionsKeys: systemData.actions ? Object.keys(systemData.actions) : []
        });
        
        const itemData = {
          name: name,
          img: img,
          type: "domainCard",
          system: systemData,
        };
        
        // Log para debug - verificar se actions estão em itemData
        console.log(`[${MODULE_ID}] _onSave (shouldCreate) - itemData.system.actions:`, {
          hasActions: !!itemData.system.actions,
          actionsCount: itemData.system.actions ? Object.keys(itemData.system.actions).length : 0,
          actionsKeys: itemData.system.actions ? Object.keys(itemData.system.actions) : []
        });

        // Se estamos criando a partir de um nó, verificar se está desbloqueado antes de adicionar
        if (this.node && this.domainId && this.talentTreeApp) {
          const talentTreeData = this.talentTreeApp.getTalentTreeData();
          const isNodeUnlocked = talentTreeData.unlockedNodes.includes(this.node.id);
          
          if (isNodeUnlocked) {
            // Nó está desbloqueado, criar e adicionar a carta ao personagem
            try {
              // Verificar se já existe uma carta com esse nome
              const existingCardWithName = this.actor.items.find(item => 
                item.type === "domainCard" && item.name === name && 
                (!this.cardData?.id || item.id !== this.cardData.id)
              );
              
              if (existingCardWithName) {
                // Se já existe uma carta com esse nome, usar ela em vez de criar nova
                await this._associateCardToNode(existingCardWithName);
                ui.notifications.info(
                  game.i18n.format(`${MODULE_ID}.edit-card.card-added`, { name: name })
                );
              } else {
                // Criar nova carta
                const createdItems = await Item.create([itemData], { parent: this.actor });
                const createdItem = createdItems[0];
                if (createdItem) {
                  await this._associateCardToNode(createdItem);
                  ui.notifications.info(
                    game.i18n.format(`${MODULE_ID}.edit-card.card-added`, { name: name })
                  );
                } else {
                  // Se não conseguiu criar, salvar no nó mesmo assim
                  await this._associateCardToNodeWithoutItem(itemData, name, img, description);
                  ui.notifications.warn(
                    game.i18n.format(`${MODULE_ID}.edit-card.card-saved`, { name: name })
                  );
                }
              }
              } catch (error) {
              // Se falhar ao criar (ex: nome duplicado), verificar se existe uma carta com esse nome
              const existingCardWithName = this.actor.items.find(item => 
                item.type === "domainCard" && item.name === name
              );
              if (existingCardWithName) {
                // Usar a carta existente
                await this._associateCardToNode(existingCardWithName);
                ui.notifications.info(
                  game.i18n.format(`${MODULE_ID}.edit-card.card-added`, { name: name })
                );
              } else {
                // Se não existe, salvar no nó mesmo assim
                await this._associateCardToNodeWithoutItem(itemData, name, img, description);
                ui.notifications.warn(
                  `Erro ao criar carta: ${error.message}. Dados salvos no nó para criação posterior.`
                );
              }
            }
          } else {
            // Nó não está desbloqueado, apenas salvar no nó sem adicionar ao personagem
            await this._associateCardToNodeWithoutItem(itemData, name, img, description);
            ui.notifications.info(
              game.i18n.format(`${MODULE_ID}.edit-card.card-saved`, { name: name })
            );
          }
        } else {
          // Não está associado a um nó, criar normalmente
          try {
            const createdItems = await Item.create([itemData], { parent: this.actor });
            const createdItem = createdItems[0];
            if (createdItem) {
              ui.notifications.info(
                game.i18n.format(`${MODULE_ID}.edit-card.card-added`, { name: name })
              );
            }
          } catch (error) {
            ui.notifications.error(
              `Erro ao criar carta: ${error.message}`
            );
          }
        }
      } else {
        // Atualizar item existente no personagem (não é de compendium)
        // Buscar o item em todos os itens do personagem, não apenas no loadout
        // Tentar encontrar pelo ID primeiro
        let existingItem = this.currentItem || this.actor.items.get(this.cardData?.id);
        
        // Se não encontrou pelo ID, tentar encontrar pelo nome e tipo (caso o ID tenha mudado)
        if (!existingItem && this.cardData?.name) {
          existingItem = this.actor.items.find(item => 
            item.type === "domainCard" && 
            item.name === this.cardData.name &&
            (!this.cardData.id || item.id === this.cardData.id)
          );
        }
        
        // Se ainda não encontrou e temos domainCardUuid, tentar carregar diretamente
        if (!existingItem && this.node?.domainCardUuid) {
          try {
            const itemFromUuid = await foundry.utils.fromUuid(this.node.domainCardUuid);
            if (itemFromUuid && this.actor.items.has(itemFromUuid.id)) {
              existingItem = itemFromUuid;
            }
          } catch (error) {
            console.warn(`[${MODULE_ID}] Erro ao carregar item via domainCardUuid:`, error);
          }
        }
        
        if (!existingItem) {
          // Item não existe mais no personagem, criar novo
          const baseSystem = this.cardData?.system || {};
          
          // Preparar descrição - pode ser string ou HTMLField
          let descriptionData = description;
          if (baseSystem.description && typeof baseSystem.description === "object" && baseSystem.description.value !== undefined) {
            descriptionData = foundry.utils.mergeObject(baseSystem.description, { value: description }, { inplace: false });
          }
          
          // Preparar descrição - pode ser string ou HTMLField
          let descriptionDataForItem = description;
          if (baseSystem.description && typeof baseSystem.description === "object" && baseSystem.description.value !== undefined) {
            descriptionDataForItem = foundry.utils.mergeObject(baseSystem.description, { value: description }, { inplace: false });
          }
          
          // Clonar baseSystem para não modificar o original
          const clonedBaseSystem = foundry.utils.deepClone(baseSystem);
          const systemData = foundry.utils.mergeObject(
            clonedBaseSystem,
            {
              domain: baseSystem.domain || CONFIG.DH?.DOMAIN?.domains?.arcana?.id || "arcana",
              level: baseSystem.level || 1,
              recallCost: recallCost,
              type: baseSystem.type || CONFIG.DH?.DOMAIN?.cardTypes?.ability?.id || "ability",
              inVault: baseSystem.inVault || false,
            },
            { inplace: false, insertKeys: true } // Inserir campos extras
          );
          
          // SEMPRE sobrescrever a descrição com a editada (forçar após o merge)
          systemData.description = descriptionDataForItem;
          
          // Garantir que as actions sejam preservadas explicitamente
          if (this.baseActions) {
            systemData.actions = foundry.utils.deepClone(this.baseActions);
            console.log(`[${MODULE_ID}] _onSave (item não existe) - Actions preservadas:`, Object.keys(systemData.actions).length);
          } else if (baseSystem.actions) {
            if (baseSystem.actions instanceof foundry.utils.Collection) {
              const actionsObj = {};
              for (const [key, action] of baseSystem.actions.entries()) {
                actionsObj[key] = foundry.utils.deepClone(action.toObject());
              }
              systemData.actions = actionsObj;
            } else if (typeof baseSystem.actions === 'object' && baseSystem.actions !== null) {
              systemData.actions = foundry.utils.deepClone(baseSystem.actions);
            }
          }
          
          const itemData = {
            name: name,
            img: img,
            type: "domainCard",
            system: systemData,
          };
          
          // Se estamos criando a partir de um nó, verificar se está desbloqueado antes de adicionar
          if (this.node && this.domainId && this.talentTreeApp) {
            const talentTreeData = this.talentTreeApp.getTalentTreeData();
            const isNodeUnlocked = talentTreeData.unlockedNodes.includes(this.node.id);
            
            if (isNodeUnlocked) {
              // Nó está desbloqueado, criar e adicionar a carta ao personagem
              try {
                // Verificar se já existe uma carta com esse nome
                const existingCardWithName = this.actor.items.find(item => 
                  item.type === "domainCard" && item.name === name && 
                  (!this.cardData?.id || item.id !== this.cardData.id)
                );
                
                if (existingCardWithName) {
                  // Se já existe uma carta com esse nome e não é a que estamos editando, apenas atualizar a associação
                  await this._associateCardToNode(existingCardWithName);
                  ui.notifications.info(
                    game.i18n.format(`${MODULE_ID}.edit-card.card-added`, { name: name })
                  );
                } else {
                  // Criar nova carta
                  const createdItems = await Item.create([itemData], { parent: this.actor });
                  const createdItem = createdItems[0];
                  if (createdItem) {
                    await this._associateCardToNode(createdItem);
                    ui.notifications.info(
                      game.i18n.format(`${MODULE_ID}.edit-card.card-added`, { name: name })
                    );
                  } else {
                    // Se não conseguiu criar, salvar no nó mesmo assim
                    await this._associateCardToNodeWithoutItem(itemData, name, img, description);
                    ui.notifications.warn(
                      game.i18n.format(`${MODULE_ID}.edit-card.card-saved`, { name: name })
                    );
                  }
                }
              } catch (error) {
                // Se falhar ao criar, salvar no nó mesmo assim
                await this._associateCardToNodeWithoutItem(itemData, name, img, description);
                ui.notifications.warn(
                  `Erro ao criar carta: ${error.message}. Dados salvos no nó para criação posterior.`
                );
              }
            } else {
              // Nó não está desbloqueado, apenas salvar no nó sem adicionar ao personagem
              await this._associateCardToNodeWithoutItem(itemData, name, img, description);
              ui.notifications.info(
                game.i18n.format(`${MODULE_ID}.edit-card.card-saved`, { name: name })
              );
            }
          } else {
            // Não está associado a um nó, criar normalmente
            const createdItems = await Item.create([itemData], { parent: this.actor });
            const createdItem = createdItems[0];
            if (createdItem) {
              ui.notifications.info(
                game.i18n.format(`${MODULE_ID}.edit-card.card-added`, { name: name })
              );
            }
          }
        } else if (shouldUpdate) {
          // Atualizar item existente
          // Usar o existingItem que já foi verificado anteriormente
          if (!existingItem) {
            // Item não existe mais, tentar encontrar pelo cardData.id
            const itemById = this.cardData?.id ? this.actor.items.get(this.cardData.id) : null;
            if (itemById && itemById.type === "domainCard") {
              existingItem = itemById;
            } else {
              // Item não existe mais, criar novo
              ui.notifications.warn(`Item não encontrado no personagem. Criando nova carta.`);
              // Recursivamente chamar a lógica de criação
              this.isNewCard = true;
              this.cardData = null;
              this.currentItem = null;
              // Re-executar a lógica de criação (chamando novamente o método)
              return await this._onSave(event);
            }
          }
          
          console.log(`[${MODULE_ID}] _onSave - Atualizando item existente:`, existingItem.id, existingItem.name);
          
          // Preservar todos os campos do sistema e apenas atualizar descrição e nome/img
          // Descrição pode ser HTMLField (objeto com value) ou string direto
          const currentDescription = existingItem.system.description;
          
          // Sempre atualizar a descrição - HTMLField aceita string pura ou HTML
          // IMPORTANTE: Verificar se description é um HTMLField (objeto) ou string
          const updateData = {
            name: name,
            img: img,
            "system.recallCost": recallCost,
          };
          
          // Atualizar descrição baseado no tipo
          if (currentDescription && typeof currentDescription === "object" && currentDescription.value !== undefined) {
            // É um HTMLField, usar dot notation para atualizar apenas o value
            updateData["system.description.value"] = description;
          } else {
            // É uma string, atualizar diretamente
            updateData["system.description"] = description;
          }
          
          // Sempre preservar actions
          // PRIORIDADE 1: Se temos actions em cardData.system.actions (adicionadas durante edição), usar elas
          if (this.cardData?.system?.actions && Object.keys(this.cardData.system.actions).length > 0) {
            // Atualizar system.actions diretamente
            // Usar dot notation para atualizar cada action individualmente
            const actionsUpdate = {};
            for (const [actionId, actionData] of Object.entries(this.cardData.system.actions)) {
              // Garantir que temos _id
              const finalActionId = actionData._id || actionId;
              actionsUpdate[`system.actions.${finalActionId}`] = foundry.utils.deepClone(actionData);
            }
            // Mesclar com updateData
            Object.assign(updateData, actionsUpdate);
            console.log(`[${MODULE_ID}] _onSave - ${Object.keys(this.cardData.system.actions).length} actions do cardData preservadas no item existente`);
          }
          // PRIORIDADE 2: Se não, usar baseActions (actions preservadas da carta original)
          else if (this.baseActions) {
            // Atualizar system.actions diretamente
            // Usar dot notation para atualizar cada action individualmente
            const actionsUpdate = {};
            for (const [actionId, actionData] of Object.entries(this.baseActions)) {
              // Garantir que temos _id
              const finalActionId = actionData._id || actionId;
              actionsUpdate[`system.actions.${finalActionId}`] = foundry.utils.deepClone(actionData);
            }
            // Mesclar com updateData
            Object.assign(updateData, actionsUpdate);
            console.log(`[${MODULE_ID}] _onSave - ${Object.keys(this.baseActions).length} actions preservadas no item existente`);
          }
          
          await existingItem.update(updateData);
          
          // Atualizar currentItem após salvar para garantir que está sincronizado
          // Recarregar o item do actor para garantir que está atualizado
          const updatedItem = this.actor.items.get(existingItem.id);
          if (updatedItem) {
            this.currentItem = updatedItem;
            this.cardData = updatedItem;
            console.log(`[${MODULE_ID}] _onSave - currentItem atualizado após salvar:`, this.currentItem.id);
          } else {
            this.currentItem = existingItem;
            this.cardData = existingItem;
          }
          
          // Se estamos editando a partir de um nó, atualizar a associação com os dados atualizados
          if (this.node && this.domainId && this.talentTreeApp && existingItem) {
            // Passar a descrição diretamente para garantir que usamos o valor atualizado
            await this._associateCardToNode(existingItem, description);
            // Atualizar node após associar
            const talentTreeData = this.talentTreeApp.getTalentTreeData();
            const domain = talentTreeData.domains.find(d => d.id === this.domainId);
            if (domain) {
              const nodeToUpdate = domain.nodes.find(n => n.id === this.node.id);
              if (nodeToUpdate) {
                this.node = nodeToUpdate;
                console.log(`[${MODULE_ID}] _onSave - node atualizado após associar:`, this.node.domainCardUuid);
              }
            }
          }
          
          ui.notifications.info(
            game.i18n.format(`${MODULE_ID}.edit-card.card-updated`, { name: name })
          );
        }
      }

      // Fechar a janela após salvar
      this.close();
    } catch (error) {
      ui.notifications.error(
        game.i18n.format(`${MODULE_ID}.edit-card.save-error`, { error: error.message })
      );
    }
  }

  async _associateCardToNode(item, descriptionOverride = null) {
    if (!this.node || !this.domainId || !this.talentTreeApp) return;
    
      // Verificar se o item existe e tem UUID
      if (!item || !item.uuid) {
        return;
      }

    try {
      const talentTreeData = this.talentTreeApp.getTalentTreeData();
      const domain = talentTreeData.domains.find(d => d.id === this.domainId);
      if (!domain) return;

      const node = domain.nodes.find(n => n.id === this.node.id);
      if (!node) return;

      // Associar a carta ao nó usando UUID
      node.domainCardUuid = item.uuid;
      
      // Atualizar também o nome e ícone do nó para refletir a carta
      node.label = item.name;
      node.icon = item.img;
      
      // Atualizar a descrição do nó
      // Se descriptionOverride foi fornecido, usar ele (caso do update)
      // Caso contrário, tentar ler do item
      if (descriptionOverride !== null) {
        node.description = descriptionOverride;
        console.log(`[${MODULE_ID}] _associateCardToNode - Descrição salva do override:`, descriptionOverride);
      } else if (item.system && item.system.description) {
        if (typeof item.system.description === "object" && item.system.description.value !== undefined) {
          node.description = item.system.description.value;
          console.log(`[${MODULE_ID}] _associateCardToNode - Descrição salva do item.value:`, item.system.description.value);
        } else {
          node.description = item.system.description;
          console.log(`[${MODULE_ID}] _associateCardToNode - Descrição salva do item:`, item.system.description);
        }
      } else {
        console.warn(`[${MODULE_ID}] _associateCardToNode - Nenhuma descrição encontrada no item`);
      }
      
      console.log(`[${MODULE_ID}] _associateCardToNode - Node após atualização:`, {
        id: node.id,
        label: node.label,
        icon: node.icon,
        description: node.description,
        domainCardUuid: node.domainCardUuid
      });
      
      // Marcar como imagem para que o template renderize como <img> e não como ícone Font Awesome
      node.isImage = true;
      
      // Limpar dados temporários se existirem
      delete node.domainCardData;
      delete node.domainCardName;
      delete node.domainCardImg;
      delete node.domainCardDescription;
      
      // Salvar a árvore de talentos
      await this.talentTreeApp.saveTalentTreeData(talentTreeData);
      
      // Renderizar a árvore novamente para atualizar os dados na interface
      await this.talentTreeApp.render(false);
      
      console.log(`[${MODULE_ID}] _associateCardToNode - Carta associada ao nó e árvore renderizada:`, {
        nodeId: node.id,
        domainCardUuid: node.domainCardUuid,
        cardName: item.name
      });
    } catch (error) {
      console.error(`[${MODULE_ID}] Erro ao associar carta ao nó:`, error);
    }
  }

  async _associateCardToNodeWithoutItem(itemData, name, img, description) {
    if (!this.node || !this.domainId || !this.talentTreeApp) return;

    try {
      const talentTreeData = this.talentTreeApp.getTalentTreeData();
      const domain = talentTreeData.domains.find(d => d.id === this.domainId);
      if (!domain) return;

      const node = domain.nodes.find(n => n.id === this.node.id);
      if (!node) return;

      // Criar uma cópia profunda do itemData para não modificar o original
      const itemDataCopy = foundry.utils.deepClone(itemData);
      
      // Log para debug - verificar se actions estão em itemDataCopy antes de salvar
      console.log(`[${MODULE_ID}] _associateCardToNodeWithoutItem - itemDataCopy.system.actions:`, {
        hasActions: !!itemDataCopy.system?.actions,
        actionsCount: itemDataCopy.system?.actions ? Object.keys(itemDataCopy.system.actions).length : 0,
        actionsKeys: itemDataCopy.system?.actions ? Object.keys(itemDataCopy.system.actions) : []
      });
      
      // IMPORTANTE: Garantir que a descrição esteja corretamente atualizada no itemData
      // A descrição pode ser string ou HTMLField (objeto com value)
      if (itemDataCopy.system && itemDataCopy.system.description) {
        // Se description é um objeto HTMLField, atualizar apenas o value
        if (typeof itemDataCopy.system.description === "object" && itemDataCopy.system.description.value !== undefined) {
          itemDataCopy.system.description.value = description;
        } else {
          // Se é string direto, substituir
          itemDataCopy.system.description = description;
        }
      } else {
        // Se não existe description no system, criar
        if (!itemDataCopy.system) {
          itemDataCopy.system = {};
        }
        itemDataCopy.system.description = description;
      }
      
      // Garantir que nome e imagem também estejam atualizados
      itemDataCopy.name = name;
      itemDataCopy.img = img;
      
      // Salvar os dados da carta no nó (sem UUID ainda, pois o item não foi criado)
      node.domainCardData = itemDataCopy; // Armazenar dados completos para criar depois
      node.domainCardName = name;
      node.domainCardImg = img;
      node.domainCardDescription = description; // Salvar também separadamente para garantir
      
      // Atualizar também o nome e ícone do nó para refletir a carta
      node.label = name;
      node.icon = img;
      
      // Atualizar a descrição do nó
      node.description = description;
      
      // Log para debug - verificar se actions foram salvas no node.domainCardData
      console.log(`[${MODULE_ID}] _associateCardToNodeWithoutItem - Node após atualização:`, {
        id: node.id,
        label: node.label,
        icon: node.icon,
        description: node.description,
        hasDomainCardData: !!node.domainCardData,
        hasActions: !!node.domainCardData?.system?.actions,
        actionsCount: node.domainCardData?.system?.actions ? Object.keys(node.domainCardData.system.actions).length : 0,
        actionsKeys: node.domainCardData?.system?.actions ? Object.keys(node.domainCardData.system.actions) : []
      });
      
      // Marcar como imagem para que o template renderize como <img> e não como ícone Font Awesome
      node.isImage = true;
      
      // Limpar UUID antigo se existir (já que não temos item ainda)
      delete node.domainCardUuid;
      
      // Salvar a árvore de talentos
      await this.talentTreeApp.saveTalentTreeData(talentTreeData);
    } catch (error) {
      // Erro silencioso - não precisa logar
    }
  }

  static async #onSubmit(event, form, formData) {
    // Implementar se necessário
  }
}


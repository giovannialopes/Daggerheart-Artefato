import { MODULE_ID } from "./constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class SelectCardApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-select-card`,
    tag: "div",
    window: {
      title: "Selecionar Carta de Domínio",
      icon: "fas fa-address-card",
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 600,
      height: "auto",
    },
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/select-card.hbs`,
    },
  };

  constructor(node, domainId, talentTreeApp, options = {}) {
    const defaultOptions = foundry.utils.mergeObject({}, SelectCardApplication.DEFAULT_OPTIONS);
    defaultOptions.window.title = game.i18n.localize(`${MODULE_ID}.select-card.title`);
    super(foundry.utils.mergeObject(defaultOptions, options));
    this.node = node;
    this.domainId = domainId;
    this.talentTreeApp = talentTreeApp;
    this.isGM = game.user.isGM;
    this.actor = talentTreeApp.actor;
  }

  static async open(node, domainId, talentTreeApp) {
    if (!game.user.isGM) {
      ui.notifications.error(game.i18n.localize(`${MODULE_ID}.select-card.permission-error`));
      return;
    }

    // Verificar se já existe uma instância aberta
    const existingApp = ui.applications ? Object.values(ui.applications).find(
      (app) => app instanceof SelectCardApplication && app.node?.id === node.id
    ) : null;

    if (existingApp) {
      existingApp.bringToTop();
      return;
    }

    const app = new SelectCardApplication(node, domainId, talentTreeApp);
    app.render(true);
    return app;
  }

  async _prepareContext(options) {
    // Obter todas as cartas de domínio do personagem
    let domainCards = this.actor.items.filter(item => item.type === "domainCard");
    
    // Filtrar cartas de acordo com a classe do jogador
    try {
      // Obter domínios da classe do jogador (pode ser um getter)
      const playerDomains = this.actor.system?.domains || [];
      
      if (Array.isArray(playerDomains) && playerDomains.length > 0) {
        // Filtrar apenas cartas cujo domínio está na lista de domínios da classe
        domainCards = domainCards.filter(card => {
          const cardDomain = card.system?.domain;
          return cardDomain && playerDomains.includes(cardDomain);
        });
      }
    } catch (error) {
      console.warn(`[${MODULE_ID}] Erro ao filtrar cartas por classe:`, error);
      // Se houver erro, mostrar todas as cartas
    }
    
    // Pré-localizar strings para o template
    const i18n = {
      title: game.i18n.localize(`${MODULE_ID}.select-card.title`),
      selectCard: game.i18n.localize(`${MODULE_ID}.select-card.select-card`),
      selectCardHelp: game.i18n.localize(`${MODULE_ID}.select-card.select-card-help`),
      noCards: game.i18n.localize(`${MODULE_ID}.select-card.no-cards`),
      alreadyAssociated: game.i18n.localize(`${MODULE_ID}.select-card.already-associated`),
      clickToAssociate: game.i18n.localize(`${MODULE_ID}.select-card.click-to-associate`),
      removeCard: game.i18n.localize(`${MODULE_ID}.select-card.remove-card`),
      editNode: game.i18n.localize(`${MODULE_ID}.select-card.edit-node`),
      createCard: game.i18n.localize(`${MODULE_ID}.select-card.create-card`),
    };

    // Preparar nós com flag isSelected para o template
    const cardsWithStatus = domainCards.map(card => ({
      ...card,
      isSelected: this.node.domainCardUuid === card.uuid
    }));

    return {
      node: this.node,
      domainId: this.domainId,
      domainCards: cardsWithStatus,
      isGM: this.isGM,
      i18n: i18n,
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this._attachListeners();
  }

  _attachListeners() {
    if (!this.element) return;

    const $element = this.element instanceof jQuery ? this.element : $(this.element);

    // Listener para seleção de cartas
    $element.find(".domain-card-item").off("click").on("click", (e) => {
      this._onSelectCard(e);
    });

    // Listener para remover carta
    $element.find(".remove-card-button").off("click").on("click", (e) => {
      this._onRemoveCard(e);
    });

    // Listener para editar nó
    $element.find(".edit-node-button").off("click").on("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._onEditNode(e);
    });

    // Listener para criar nova carta
    $element.find(".create-card-button").off("click").on("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._onCreateCard(e);
    });

  }

  async _onSelectCard(event) {
    event.preventDefault();
    if (!this.isGM) return;

    const $element = this.element instanceof jQuery ? this.element : $(this.element);
    const cardUuid = $(event.currentTarget).data("card-uuid");
    if (!cardUuid) return;

    const card = this.actor.items.find(item => item.uuid === cardUuid);
    if (!card || card.type !== "domainCard") return;

    const talentTreeData = this.talentTreeApp.getTalentTreeData();
    const domain = talentTreeData.domains.find(d => d.id === this.domainId);
    if (!domain) return;

    const node = domain.nodes.find(n => n.id === this.node.id);
    if (!node) return;

    // Associar a carta ao nó
    node.domainCardUuid = card.uuid;
    node.label = card.name;
    node.icon = card.img;
    
    // Obter descrição da carta se disponível
    if (card.system && card.system.description) {
      if (typeof card.system.description === "object" && card.system.description.value !== undefined) {
        node.description = card.system.description.value;
      } else {
        node.description = card.system.description;
      }
    }
    
    // Marcar como imagem para que o template renderize como <img> e não como ícone Font Awesome
    node.isImage = true;

    await this.talentTreeApp.saveTalentTreeData(talentTreeData);
    
    // Atualizar referência local do nó
    this.node = node;
    
    ui.notifications.info(
      game.i18n.format(`${MODULE_ID}.select-card.card-associated`, { card: card.name })
    );
    
    // Atualizar a interface
    await this.render(false);
  }

  async _onRemoveCard(event) {
    event.preventDefault();
    if (!this.isGM) return;

    const talentTreeData = this.talentTreeApp.getTalentTreeData();
    const domain = talentTreeData.domains.find(d => d.id === this.domainId);
    if (!domain) return;

    const node = domain.nodes.find(n => n.id === this.node.id);
    if (!node) return;

    // Remover associação da carta
    delete node.domainCardUuid;
    
    // Resetar para valores padrão se necessário
    if (!node.label || node.label.startsWith("Nó")) {
      node.label = `Nó ${this.node.id.split("-").pop()}`;
    }

    await this.talentTreeApp.saveTalentTreeData(talentTreeData);
    
    // Atualizar referência local do nó
    this.node = node;
    
    ui.notifications.info(game.i18n.localize(`${MODULE_ID}.select-card.card-removed`));
    
    // Atualizar a interface
    await this.render(false);
  }

  async _onEditNode(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isGM) return;

    try {
      // Importar EditNodeApplication dinamicamente para evitar dependências circulares
      const { EditNodeApplication } = await import("./edit-node.js");
      
      // Não fechar esta janela, apenas abrir a de edição
      // O usuário pode querer voltar para selecionar uma carta depois
      await EditNodeApplication.open(this.node, this.domainId, this.talentTreeApp);
      } catch (error) {
        ui.notifications.error(`Erro ao abrir editor de nó: ${error.message}`);
      }
  }

  async _onCreateCard(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isGM) return;

    try {
      // Importar EditCardApplication dinamicamente
      const { EditCardApplication } = await import("./edit-card.js");
      
      // Abrir a tela de criação de carta
      await EditCardApplication.open(this.actor);
    } catch (error) {
      ui.notifications.error(`Erro ao abrir editor de carta: ${error.message}`);
    }
  }

  static async #onSubmit(event, form, formData) {
    // Implementar se necessário
  }
}


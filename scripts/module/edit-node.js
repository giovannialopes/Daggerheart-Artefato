import { MODULE_ID } from "./constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class EditNodeApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-edit-node`,
    tag: "div",
    window: {
      title: "Editar Nó",
      icon: "fas fa-edit",
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 500,
      height: "auto",
    },
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/edit-node.hbs`,
    },
  };

  constructor(node, domainId, talentTreeApp, options = {}) {
    const defaultOptions = foundry.utils.mergeObject({}, EditNodeApplication.DEFAULT_OPTIONS);
    defaultOptions.window.title = game.i18n.localize(`${MODULE_ID}.edit-node.title`);
    super(foundry.utils.mergeObject(defaultOptions, options));
    this.node = node;
    this.domainId = domainId;
    this.talentTreeApp = talentTreeApp;
    this.isGM = game.user.isGM;
  }

  static async open(node, domainId, talentTreeApp) {
    if (!game.user.isGM) {
      ui.notifications.error(game.i18n.localize(`${MODULE_ID}.edit-node.permission-error`));
      return;
    }

    // Verificar se já existe uma instância aberta
    const existingApp = ui.applications ? Object.values(ui.applications).find(
      (app) => app instanceof EditNodeApplication && app.node?.id === node.id
    ) : null;

    if (existingApp) {
      existingApp.bringToTop();
      return;
    }

    const app = new EditNodeApplication(node, domainId, talentTreeApp);
    app.render(true);
    return app;
  }

  async _prepareContext(options) {
    // Pré-localizar strings para o template
    const i18n = {
      title: game.i18n.localize(`${MODULE_ID}.edit-node.title`),
      nodeName: game.i18n.localize(`${MODULE_ID}.edit-node.node-name`),
      nodeIcon: game.i18n.localize(`${MODULE_ID}.edit-node.node-icon`),
      nodeDescription: game.i18n.localize(`${MODULE_ID}.edit-node.node-description`),
      save: game.i18n.localize(`${MODULE_ID}.edit-node.save`),
      cancel: game.i18n.localize(`${MODULE_ID}.edit-node.cancel`),
      iconHelp: game.i18n.localize(`${MODULE_ID}.edit-node.icon-help`),
    };

    return {
      node: this.node,
      domainId: this.domainId,
      isGM: this.isGM,
      i18n: i18n,
    };
  }

  _attachListeners() {
    if (!this.element) return;

    const $element = this.element instanceof jQuery ? this.element : $(this.element);

    // Listener para salvar
    $element.find(".save-node-button").off("click").on("click", this._onSave.bind(this));

    // Listener para cancelar
    $element.find(".cancel-node-button").off("click").on("click", () => {
      this.close();
    });
  }

  async _onSave(event) {
    event.preventDefault();
    if (!this.isGM) return;

    const $element = this.element instanceof jQuery ? this.element : $(this.element);
    const form = $element.find(".edit-node-form")[0];
    if (!form) return;

    const formData = new FormData(form);
    
    // Obter dados do formulário
    const label = formData.get("label") || "Nó sem nome";
    const icon = formData.get("icon") || "fas fa-circle";
    const description = formData.get("description") || "";

    // Atualizar o nó no talentTreeApp
    const talentTreeData = this.talentTreeApp.getTalentTreeData();
    const domain = talentTreeData.domains.find(d => d.id === this.domainId);
    if (!domain) return;

    const node = domain.nodes.find(n => n.id === this.node.id);
    if (!node) return;

    // Atualizar dados do nó
    node.label = label;
    node.icon = icon;
    node.description = description;

    // Salvar através do talentTreeApp
    await this.talentTreeApp.saveTalentTreeData(talentTreeData);
    
    // Atualizar referência local do nó
    this.node = node;
    
    ui.notifications.info(game.i18n.localize(`${MODULE_ID}.edit-node.node-updated`));
    
    // Opcionalmente fechar a janela após salvar
    // this.close();
  }

  static async #onSubmit(event, form, formData) {
    // Implementar se necessário
  }
}


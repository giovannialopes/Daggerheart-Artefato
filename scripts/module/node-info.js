import { MODULE_ID } from "./constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class NodeInfoApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-node-info`,
    tag: "div",
    window: {
      title: "Informações do Nó",
      icon: "fas fa-info-circle",
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 600,
      height: 700,
    },
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/node-info.hbs`,
    },
  };

  constructor(nodeData, options = {}) {
    const defaultOptions = foundry.utils.mergeObject({}, NodeInfoApplication.DEFAULT_OPTIONS);
    defaultOptions.window.title = nodeData.name || "Informações do Nó";
    super(foundry.utils.mergeObject(defaultOptions, options));
    this.nodeData = nodeData;
  }

  static async open(nodeData) {
    // Verificar se já existe uma instância aberta
    const existingApp = ui.applications ? Object.values(ui.applications).find(
      app => app.id === `${MODULE_ID}-node-info` && app.nodeData?.id === nodeData.id
    ) : null;

    if (existingApp) {
      existingApp.bringToTop();
      return existingApp;
    }

    const app = new NodeInfoApplication(nodeData);
    app.render(true);
    return app;
  }

  async _prepareContext(options) {
    // Processar a descrição para melhor formatação
    let description = this.nodeData.description || "";
    
    // Se a descrição é HTML, garantir que está bem formatada
    if (description) {
      // Se não começa com tag HTML, tratar como texto simples e converter quebras de linha
      if (!description.trim().startsWith('<')) {
        // Converter quebras de linha em parágrafos
        description = description
          .split('\n\n')
          .filter(p => p.trim())
          .map(p => `<p>${p.trim().replace(/\n/g, '<br>')}</p>`)
          .join('');
      }
    }
    
    return {
      node: {
        ...this.nodeData,
        description: description
      },
    };
  }
  
  _onRender(context, options) {
    super._onRender?.(context, options);
    
    // Aplicar formatação adicional após renderizar
    if (this.element) {
      const $element = this.element instanceof jQuery ? this.element : $(this.element);
      const $description = $element.find('.node-info-description');
      
      // Garantir que o texto está bem formatado
      $description.each((index, el) => {
        const $el = $(el);
        // Se o conteúdo parece ser texto simples sem tags, converter para parágrafos
        const html = $el.html();
        if (html && !html.includes('<p>') && !html.includes('<div>') && html.includes('\n')) {
          const formatted = html
            .split('\n\n')
            .filter(p => p.trim())
            .map(p => `<p>${p.trim().replace(/\n/g, '<br>')}</p>`)
            .join('');
          $el.html(formatted);
        }
      });
    }
  }
}


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
      width: 600,
      height: "auto",
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
    this.isNewCard = !cardData;
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

    const cardFields = {
      name: this.cardData?.name || "",
      img: this.cardData?.img || "icons/svg/item-bag.svg",
      description: description,
    };

    return {
      actor: this.actor,
      cardData: cardFields,
      isNewCard: this.isNewCard,
      isGM: this.isGM,
      i18n: i18n,
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this._attachListeners();
    this._setupDragAndDrop();
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

    // Listener para mudança de imagem
    $element.find("#card-image-input").off("change").on("change", (e) => {
      const file = e.target.files[0];
      if (file && file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (event) => {
          $element.find("#card-image-preview").attr("src", event.target.result);
        };
        reader.readAsDataURL(file);
      }
    });

    // Listener para preview de imagem via URL
    $element.find("#card-image-url").off("input").on("input", (e) => {
      const url = $(e.target).val();
      if (url) {
        $element.find("#card-image-preview").attr("src", url).on("error", function() {
          // Se a imagem falhar ao carregar, mostrar ícone padrão
          $(this).attr("src", "icons/svg/item-bag.svg");
        });
      }
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
              $(this).attr("src", "icons/svg/item-bag.svg");
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

    // Listener para botão de carregar imagem
    $element.find(".load-image-button").off("click").on("click", (e) => {
      e.preventDefault();
      const url = $element.find("#card-image-url").val().trim();
      if (url) {
        // Forçar atualização do preview
        const preview = $element.find("#card-image-preview");
        preview.off("error"); // Remover handlers anteriores
        preview.attr("src", ""); // Limpar primeiro para forçar reload
        preview.attr("src", url);
        
        // Adicionar handler de erro apenas uma vez
        preview.one("error", function() {
          ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.edit-card.image-load-error`));
          $(this).attr("src", "icons/svg/item-bag.svg");
        });
        
        // Se carregar com sucesso, fazer um pequeno delay para verificar
        preview.one("load", function() {
          // Imagem carregada com sucesso
        });
      } else {
        ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.edit-card.image-url-empty`));
      }
    });

    // Listener para Enter no campo de URL
    $element.find("#card-image-url").off("keypress").on("keypress", (e) => {
      if (e.which === 13) { // Enter
        e.preventDefault();
        $element.find(".load-image-button").click();
      }
    });
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
            ui.notifications.info(
              game.i18n.format(`${MODULE_ID}.edit-card.card-loaded`, { name: item.name })
            );
          }
        }
      } catch (error) {
        // Erro silencioso ao processar item arrastado
      }
    });
  }

  _fillFormFromItem(item) {
    if (!this.element) return;

    const $element = this.element instanceof jQuery ? this.element : $(this.element);
    
    // Preencher campos do formulário
    $element.find("#card-name").val(item.name || "");
    $element.find("#card-image-url").val(item.img || "");
    $element.find("#card-image-preview").attr("src", item.img || "icons/svg/item-bag.svg");
    
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
    }

    // Atualizar referência da carta para edição
    this.cardData = item;
    this.isNewCard = false;
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
    const img = formData.get("img") || "icons/svg/item-bag.svg";
    
    // IMPORTANTE: Pegar descrição do textarea diretamente via jQuery para garantir que pegamos o valor correto
    // O FormData pode não capturar corretamente o conteúdo do textarea em alguns casos
    const descriptionTextarea = $element.find("#card-description");
    const description = descriptionTextarea.val() || "";

    try {
      // Verificar se é um item de compendium (não pode atualizar, precisa criar novo)
      const isCompendiumItem = this.cardData?.pack !== undefined || 
                                this.cardData?.collection?.metadata?.packageName !== undefined ||
                                (this.cardData?.id && !this.actor.items.has(this.cardData.id));
      
      if (this.isNewCard || !this.cardData?.id || isCompendiumItem) {
        // Criar novo item (sempre criar se for novo, de compendium, ou não estiver no personagem)
        const baseSystem = this.cardData?.system || {};
        
        // Preparar descrição - pode ser string ou HTMLField
        let descriptionData = description;
        // Se o sistema original tinha description como objeto HTMLField, manter a estrutura
        if (baseSystem.description && typeof baseSystem.description === "object" && baseSystem.description.value !== undefined) {
          descriptionData = foundry.utils.mergeObject(baseSystem.description, { value: description }, { inplace: false });
        }
        
        // Preparar dados do item com campos obrigatórios do domainCard
        const itemData = {
          name: name,
          img: img,
          type: "domainCard",
          system: foundry.utils.mergeObject(
            {
              domain: baseSystem.domain || CONFIG.DH?.DOMAIN?.domains?.arcana?.id || "arcana",
              level: baseSystem.level || 1,
              recallCost: baseSystem.recallCost || 0,
              type: baseSystem.type || CONFIG.DH?.DOMAIN?.cardTypes?.ability?.id || "ability",
              inVault: baseSystem.inVault || false,
              description: descriptionData,
            },
            baseSystem,
            { inplace: false, insertKeys: false } // Preservar campos extras, mas não sobrescrever os obrigatórios
          ),
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
        // Verificar se o item realmente pertence ao personagem
        const existingItem = this.actor.items.get(this.cardData.id);
        if (!existingItem) {
          // Item não existe mais no personagem, criar novo
          const baseSystem = this.cardData?.system || {};
          
          // Preparar descrição - pode ser string ou HTMLField
          let descriptionData = description;
          if (baseSystem.description && typeof baseSystem.description === "object" && baseSystem.description.value !== undefined) {
            descriptionData = foundry.utils.mergeObject(baseSystem.description, { value: description }, { inplace: false });
          }
          
          const itemData = {
            name: name,
            img: img,
            type: "domainCard",
            system: foundry.utils.mergeObject(
              {
                domain: baseSystem.domain || CONFIG.DH?.DOMAIN?.domains?.arcana?.id || "arcana",
                level: baseSystem.level || 1,
                recallCost: baseSystem.recallCost || 0,
                type: baseSystem.type || CONFIG.DH?.DOMAIN?.cardTypes?.ability?.id || "ability",
                inVault: baseSystem.inVault || false,
                description: descriptionData,
              },
              baseSystem,
              { inplace: false, insertKeys: false }
            ),
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
            await Item.create([itemData], { parent: this.actor });
            ui.notifications.info(
              game.i18n.format(`${MODULE_ID}.edit-card.card-added`, { name: name })
            );
          }
        } else {
          // Atualizar item existente
          // Preservar todos os campos do sistema e apenas atualizar descrição e nome/img
          // Descrição pode ser HTMLField (objeto com value) ou string direto
          const currentDescription = existingItem.system.description;
          
          // Sempre atualizar a descrição - HTMLField aceita string pura ou HTML
          // IMPORTANTE: Usar dot notation para atualizar apenas o value do HTMLField
          // Se tentar atualizar "system.description" diretamente, pode não funcionar corretamente
          const updateData = {
            name: name,
            img: img,
            "system.description.value": description, // Dot notation para atualizar apenas o value
          };
          
          await existingItem.update(updateData);
          
          // Se estamos editando a partir de um nó, apenas atualizar a associação (não precisa verificar desbloqueio, pois o item já existe)
          if (this.node && this.domainId && this.talentTreeApp && existingItem) {
            await this._associateCardToNode(existingItem);
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

  async _associateCardToNode(item) {
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
      
      // Marcar como imagem para que o template renderize como <img> e não como ícone Font Awesome
      node.isImage = true;
      
      // Limpar dados temporários se existirem
      delete node.domainCardData;
      delete node.domainCardName;
      delete node.domainCardImg;
      delete node.domainCardDescription;
      
      // Salvar a árvore de talentos
      await this.talentTreeApp.saveTalentTreeData(talentTreeData);
    } catch (error) {
      // Erro silencioso ao associar carta ao nó
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


import { MODULE_ID, SYSTEM_ID } from "./module/constants.js";
import { TalentTreeApplication } from "./module/talent-tree.js";
import { EditCardApplication } from "./module/edit-card.js";
import { registerModuleSettings } from "./module/settings.js";

Hooks.once("init", () => {
  if (game.system.id !== SYSTEM_ID) {
    console.error(
      `${MODULE_ID} | Este módulo requer o sistema Daggerheart`
    );
    return;
  }

  registerModuleSettings();
});

Hooks.once("ready", async () => {
  // Registrar hooks para abrir a árvore de talentos
  registerTalentTreeHooks();
});

function registerTalentTreeHooks() {
  // Função auxiliar para adicionar o botão
        const addButtonToSheet = (html, actor) => {
          // Remover botão anterior se existir (para evitar duplicatas)
          const existingButton = html.find(".talent-tree-button");
          if (existingButton.length > 0) {
            existingButton.remove();
          }
          
          const buttonTitle = game.i18n.localize(`${MODULE_ID}.talent-tree.title`);
    
    const talentTreeButton = $(`
      <button class="talent-tree-button rail-btn" type="button" data-tooltip="${buttonTitle}" data-tooltip-direction="UP">
        <i class="fas fa-sitemap"></i>
        <span class="sr-only">${buttonTitle}</span>
      </button>
    `);
    
          talentTreeButton.on("click", (ev) => {
            ev.preventDefault();
            TalentTreeApplication.openForActor(actor);
          });

          // Tentar adicionar na área de navegação (tab-navigation)
          // Primeiro, procurar pelo container de navegação
          const navigationContainer = html.find(".tab-navigation .navigation-container");
          
          if (navigationContainer.length) {
            const settingsButton = navigationContainer.find('[data-action="openSettings"]');
            
            if (settingsButton.length) {
              talentTreeButton.insertBefore(settingsButton);
            } else {
              navigationContainer.append(talentTreeButton);
            }
          } else {
            // Tentar encontrar a área onde fica o botão de configurações
            const settingsButton = html.find('[data-action="openSettings"]');
            
            if (settingsButton.length) {
              talentTreeButton.insertBefore(settingsButton);
            } else {
              // Fallback: adicionar na área de tabs
              const sheetTabs = html.find(".sheet-tabs");
              
              if (sheetTabs.length) {
                sheetTabs.after(talentTreeButton);
              } else {
                // Último fallback: adicionar no header
                const header = html.find(".sheet-header, header");
                
                if (header.length) {
                  header.append(talentTreeButton);
                }
              }
            }
          }
  };

  // Hook para ApplicationV2 (usado pelo Daggerheart Plus)
  Hooks.on("renderApplicationV2", (app, element, data) => {
    // Ignorar nossa própria aplicação de árvore de talentos e outras Applications do módulo
    const appClassName = app.constructor?.name || "";
    if (appClassName === "TalentTreeApplication" || 
        appClassName === "SelectCardApplication" ||
        appClassName === "EditNodeApplication" ||
        appClassName === "EditCardApplication") {
      return;
    }
    
    // Verificar se é uma character sheet
    const isCharacterSheet = app.constructor?.name?.includes("CharacterSheet") || 
                            app.constructor?.name === "DaggerheartPlusCharacterSheet" ||
                            (app.actor && app.actor.type === "character");
    
    if (!isCharacterSheet) {
      return;
    }
    
    // Verificar se tem actor e se é character
    const actor = app.actor || app.document;
    if (!actor || actor.type !== "character") {
      return;
    }
    
    // Converter element para jQuery se necessário
    const html = element instanceof jQuery ? element : $(element);
    
    // Usar setTimeout para garantir que o DOM está completamente renderizado
    setTimeout(() => {
      addButtonToSheet(html, actor);
    }, 100);
  });
  
        // Hook para ActorSheet tradicional (fallback caso não use ApplicationV2)
        Hooks.on("renderActorSheet", (app, html, data) => {
          if (app.actor.type !== "character") {
            return;
          }
    
    addButtonToSheet($(html), app.actor);
  });
}

// Expor API global para outros módulos
window.daggerheartTalentTree = {
  TalentTreeApplication,
  openForActor: (actor) => TalentTreeApplication.openForActor(actor),
  EditCardApplication,
  openEditCard: (actor, cardData) => EditCardApplication.open(actor, cardData),
};

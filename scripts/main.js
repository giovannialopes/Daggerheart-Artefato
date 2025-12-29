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
        <i class="fas fa-tree"></i>
        <span class="sr-only">${buttonTitle}</span>
      </button>
    `);
    
          talentTreeButton.on("click", (ev) => {
            ev.preventDefault();
            TalentTreeApplication.openForActor(actor);
          });

          // Procurar especificamente pelo rail (barra lateral) onde ficam os botões de navegação
          // Primeiro, tentar encontrar o rail do Daggerheart Plus
          const rightRail = html.find(".floating-rail-right, .floating-rail.floating-rail-right");
          const railButtons = rightRail.find(".rail-buttons, nav");
          
          if (railButtons.length) {
            // Encontrar o botão de configurações no rail
            const settingsButton = railButtons.find('[data-action="openSettings"], .rail-btn-settings');
            
            if (settingsButton.length) {
              // Adicionar antes do botão de configurações
              talentTreeButton.insertBefore(settingsButton);
              return; // Sucesso, sair da função
            } else {
              // Se não encontrar o botão de configurações, adicionar no final do rail
              railButtons.append(talentTreeButton);
              return; // Sucesso, sair da função
            }
          }
          
          // Fallback: procurar pelo container de navegação tradicional
          const navigationContainer = html.find(".tab-navigation .navigation-container");
          
          if (navigationContainer.length) {
            const settingsButton = navigationContainer.find('[data-action="openSettings"]');
            
            if (settingsButton.length) {
              talentTreeButton.insertBefore(settingsButton);
              return; // Sucesso, sair da função
            }
          }
          
          // Se não encontrou nenhum lugar apropriado, não adicionar o botão
          // (evita adicionar em lugares indesejados)
          console.warn(`[${MODULE_ID}] Não foi possível encontrar o rail para adicionar o botão da árvore de talentos`);
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

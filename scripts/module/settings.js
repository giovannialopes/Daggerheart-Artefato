import { MODULE_ID } from "./constants.js";

export function registerModuleSettings() {
  // Configuração para armazenar dados das árvores de talentos
  game.settings.register(MODULE_ID, "talentTrees", {
    name: "Árvores de Talentos",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });
}

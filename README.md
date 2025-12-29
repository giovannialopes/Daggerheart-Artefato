# Daggerheart Talent Tree

Um módulo para Foundry VTT que permite criar e gerenciar Árvores de Talentos personalizadas para jogadores de Daggerheart.

## Funcionalidades

- **Árvore de Talentos Individual**: Cada jogador tem sua própria árvore de talentos
- **Visualização Restrita**: Jogadores podem ver apenas sua própria árvore, enquanto o GM pode ver todas
- **Domínios Customizados**: O GM pode adicionar domínios customizados às árvores dos jogadores
- **Interface Intuitiva**: Interface visual baseada no estilo do sistema Daggerheart

## Requisitos

- Foundry VTT v13 ou superior
- Sistema Daggerheart v1.2.0 ou superior

## Instalação

1. Copie esta pasta para o diretório `modules` do seu Foundry VTT
2. Ative o módulo na configuração do mundo

## Uso

- Como **Jogador**: Acesse sua árvore de talentos através do menu do personagem
- Como **GM**: Acesse todas as árvores de talentos e gerencie domínios customizados

## Publicação no Foundry VTT

### 1. Preparação para Git

1. **Criar repositório no GitHub/GitLab**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/seu-usuario/daggerheart-talent-tree.git
   git push -u origin main
   ```

2. **Criar arquivo `.gitignore`** (se não existir):
   ```
   node_modules/
   .DS_Store
   *.log
   ```

### 2. Publicar no Foundry VTT

#### Opção A: Foundry Package (Recomendado)

1. **Criar uma conta no Foundry Package Registry**:
   - Acesse: https://foundryvtt.com/packages/
   - Faça login com sua conta Foundry

2. **Preparar o `module.json`**:
   - Certifique-se de que o `module.json` está completo e correto
   - O campo `url` deve apontar para o repositório Git
   - O campo `manifest` deve apontar para o arquivo `module.json` no repositório

3. **Criar Release no Git**:
   - No GitHub/GitLab, vá em "Releases" → "Create a new release"
   - Crie uma tag (ex: `v1.0.0`)
   - Adicione notas de versão
   - Publique o release

4. **Submeter no Foundry Package Registry**:
   - Acesse: https://foundryvtt.com/packages/submit
   - Preencha o formulário com:
     - **Package Name**: Nome do seu módulo
     - **Repository URL**: URL do seu repositório Git
     - **Manifest URL**: URL direta para o `module.json` (ex: `https://raw.githubusercontent.com/seu-usuario/daggerheart-talent-tree/main/module.json`)
   - Aguarde aprovação

#### Opção B: Instalação Manual via URL

1. **Hospedar o módulo**:
   - Publique o módulo em um repositório Git público (GitHub, GitLab, etc.)
   - Certifique-se de que o `module.json` está acessível via URL direta

2. **URL de instalação**:
   ```
   https://raw.githubusercontent.com/seu-usuario/daggerheart-talent-tree/main/module.json
   ```

3. **Instalação no Foundry**:
   - No Foundry VTT, vá em "Add-on Modules" → "Install Module"
   - Cole a URL do `module.json`
   - Clique em "Install"

### 3. Estrutura do `module.json`

Certifique-se de que seu `module.json` tenha a seguinte estrutura:

```json
{
  "id": "daggerheart-talent-tree",
  "title": "Daggerheart Talent Tree",
  "description": "Módulo para criar e gerenciar Árvores de Talentos",
  "version": "1.0.0",
  "compatibility": {
    "minimum": "13",
    "verified": "13"
  },
  "url": "https://github.com/seu-usuario/daggerheart-talent-tree",
  "manifest": "https://raw.githubusercontent.com/seu-usuario/daggerheart-talent-tree/main/module.json",
  "download": "https://github.com/seu-usuario/daggerheart-talent-tree/releases/download/v1.0.0/module.zip"
}
```

### 4. Atualizações

Para atualizar o módulo:

1. Faça as alterações no código
2. Atualize a versão no `module.json`
3. Crie um novo release no Git com a nova versão
4. O Foundry VTT detectará automaticamente a atualização (se estiver no Package Registry)

## Desenvolvimento

Para desenvolvimento local:

1. Clone o repositório
2. Faça suas alterações
3. Teste no Foundry VTT local
4. Faça commit e push das alterações
# Navalha — MVP da barbearia

Aplicação web em JavaScript com API Node.js e MySQL 8.0.46. Clientes, produtos,
usuários, vendas e agendamentos são armazenados no MySQL; senhas usam bcrypt
custo 12, e as vendas atualizam o estoque dentro de uma transação.

## Requisitos

- Node.js 20 ou superior
- npm
- MySQL 8.0.46

## Instalação

1. Importe [database.sql](./database.sql) em uma conta MySQL autorizada a criar
   o banco `navalha`:

   PowerShell:

   ```powershell
   Get-Content .\database.sql | mysql -u admin -p
   ```

   macOS/Linux:

   ```sh
   mysql -u admin -p < database.sql
   ```

   Opcionalmente, para adicionar dados de demonstração em um ambiente local:

   ```powershell
   Get-Content .\seed.sql | mysql -u admin -p
   ```

   Não execute o script de demonstração em um ambiente de produção.

2. O arquivo local `.env` já está preparado para o MySQL `localhost:3306`, banco
   `navalha`, usuário `admin` e a senha informada. Se precisar recriá-lo, copie
   `.env.example` para `.env` e preencha `DB_USER` e `DB_PASSWORD`.

   O `.env` é ignorado pelo Git para manter credenciais fora do repositório.

3. Instale as dependências:

   ```sh
   npm install
   ```

4. Crie o primeiro administrador. A senha será solicitada no terminal e não
   será gravada no histórico:

   ```sh
   npm run create-admin -- admin@barbearia.com "Administrador"
   ```

   Use uma senha com pelo menos 12 caracteres.

5. Inicie o servidor:

   ```sh
   npm start
   ```

6. Acesse `http://localhost:8000`. Não abra o `index.html` diretamente como
   arquivo: a API precisa ser servida pelo Node.js.

Também é possível definir `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` e
`DB_PASSWORD` no ambiente. Se definido, `SESSION_SECRET` permite manter sessões
válidas após reiniciar o servidor; sem ele, o segredo é gerado a cada inicialização.

## Usuários e permissões

O administrador inicial pode cadastrar usuários na seção **Usuários**, definir
quem é administrador e conceder permissões individuais. Administradores têm
acesso total; usuários normais só acessam os módulos autorizados. O backend
valida as permissões em cada requisição, não apenas na interface.

## Módulos e dados

- Clientes: cadastro, consulta, edição, consentimento LGPD e histórico de atendimentos.
- Produtos e serviços: catálogo, duração dos serviços, estoque mínimo, alertas e entradas de reposição.
- Vendas: registro transacional com validação concorrente do estoque e histórico
  dos itens vendidos, descontos e comissões; descontos acima de 15% exigem credenciais de administrador.
- Agenda: agendamento público em horários livres, expediente semanal, prevenção de sobreposições,
  cancelamento até 2 horas antes e sinalização de risco de falta.
- Dashboard: faturamento, comissões, alertas de estoque e segmentação de clientes por K-Means.
- Segurança: sessões assinadas com 30 minutos de inatividade, cookie HttpOnly, token CSRF em escritas,
  bloqueio temporário após cinco falhas de login e consultas preparadas.

As vendas preservam nome e preço do produto no momento da compra. Produtos com
histórico de movimentação são desativados em vez de removidos, mantendo a
integridade do histórico.

## Organização do código (MVP)

O projeto separa responsabilidades segundo **Model–View–Presenter**:

```text
src/
  models/       MySQL, acesso aos dados, validações e regras de persistência
  presenters/   Casos de uso, permissões e coordenação dos módulos
  views/        Endpoints HTTP da API e arquivos da aplicação
  config/       Configuração do ambiente
public/
  models/       Comunicação da interface com a API
  presenters/   Interações, estado da tela e atualização da interface
  views/        HTML e CSS
scripts/        Comandos administrativos
```

- **Models** executam consultas preparadas e encapsulam o acesso ao banco.
- **Presenters** validam a operação solicitada, verificam permissões e coordenam
  os Models.
- **Views** recebem requisições, retornam respostas HTTP e exibem a interface.
- Na interface, o modelo encapsula as chamadas à API e o presenter coordena
  formulários, navegação e atualização das views.

As rotas HTTP existentes (`/api?route=...`) foram mantidas para preservar a
compatibilidade entre o navegador e o servidor.

O link público de agendamento fica em `/agendar`. Os serviços e horários
disponíveis dependem do catálogo de serviços e do expediente configurado para
cada barbeiro. Novos barbeiros recebem expediente padrão de terça a sábado,
das 9h às 20h, que pode ser alterado na seção **Agenda**.

## Backup

Instale o cliente `mysqldump`, configure `BACKUP_DIR` com um caminho absoluto
fora do repositório e execute `npm run backup`. O script cria um dump
transacional e remove arquivos com mais de 30 dias. Agende a execução diária no
gerenciador de tarefas do servidor e monitore o resultado para cumprir o RPO de
24 horas; o procedimento de restauração deve ser testado para validar o RTO de
2 horas. Em um servidor Linux, por exemplo, adicione ao crontab:

```cron
0 2 * * * cd /opt/navalha && npm run backup
```

Para restaurar um arquivo validado, importe-o no banco já criado com
`mysql -u <usuario> -p navalha < arquivo.sql`.

## Stack atual

- Front-end: HTML5, CSS3 e JavaScript ES modules sem framework, organizado em MVP.
- Back-end: Node.js (compatível com Node 20 ou superior), módulo HTTP nativo; não usa Express.
- Banco: MySQL 8.0/InnoDB, acessado por `mysql2`.
- Senhas: `bcryptjs` com custo 12.
- Testes: runner nativo `node:test`; não usa Jest.
- Execução e dependências: npm.

O repositório não contém configuração de Nginx/TLS, Docker Compose, servidor
Python/MCP ou modelos de machine learning em Python. Em produção, publique o
servidor atrás de um proxy HTTPS e configure um agendador de backups.

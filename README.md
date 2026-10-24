# Navalha — MVP da barbearia

Aplicação web em JavaScript com API Node.js e MySQL 8.0.46. Clientes, produtos,
usuários e vendas são armazenados no MySQL; as senhas são protegidas com
`scrypt`, e as vendas atualizam o estoque dentro de uma transação.

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

- Clientes: cadastro, consulta, edição e exclusão.
- Produtos: catálogo, preço e controle de estoque, com histórico de movimentações.
- Vendas: registro transacional com validação concorrente do estoque e histórico
  dos itens vendidos.
- Segurança: sessões assinadas, cookie HttpOnly, token CSRF, consultas preparadas
  e validação dos dados.

As vendas preservam nome e preço do produto no momento da compra. Produtos com
histórico de movimentação são desativados em vez de removidos, mantendo a
integridade do histórico.

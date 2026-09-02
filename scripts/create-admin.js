// Cria (ou redefine a senha de) um usuário administrador via linha de comando.
// Uso: node scripts/create-admin.js seu@email.com "sua senha" "Seu Nome"
// Normalmente você não vai precisar disso: na primeira vez que acessar /admin,
// o próprio site oferece uma tela para criar o administrador pelo navegador.
import { query, initSchema } from '../server/db.js';
import { createAdminUser, findAdminByEmail, hashPassword } from '../server/auth.js';

const [, , email, password, name] = process.argv;

if (!email || !password) {
  console.log('Uso: node scripts/create-admin.js seu@email.com "sua senha" "Seu Nome"');
  process.exit(1);
}

await initSchema();

const existing = await findAdminByEmail(email);
if (existing) {
  const { hash, salt } = hashPassword(password);
  await query('UPDATE admin_users SET password_hash = $1, salt = $2 WHERE id = $3', [hash, salt, existing.id]);
  console.log(`Senha atualizada para o administrador existente: ${email}`);
} else {
  await createAdminUser({ email, password, name: name || 'Administrador' });
  console.log(`Administrador criado: ${email}`);
}

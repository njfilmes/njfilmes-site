// Cria (ou redefine a senha de) um usuário administrador via linha de comando.
// Uso: node scripts/create-admin.js seu@email.com "sua senha" "Seu Nome"
// Normalmente você não vai precisar disso: na primeira vez que acessar /admin,
// o próprio site oferece uma tela para criar o administrador pelo navegador.
import { db } from '../server/db.js';
import { createAdminUser, findAdminByEmail, hashPassword } from '../server/auth.js';

const [, , email, password, name] = process.argv;

if (!email || !password) {
  console.log('Uso: node scripts/create-admin.js seu@email.com "sua senha" "Seu Nome"');
  process.exit(1);
}

const existing = findAdminByEmail(email);
if (existing) {
  const { hash, salt } = hashPassword(password);
  db.prepare('UPDATE admin_users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, existing.id);
  console.log(`Senha atualizada para o administrador existente: ${email}`);
} else {
  createAdminUser({ email, password, name: name || 'Administrador' });
  console.log(`Administrador criado: ${email}`);
}

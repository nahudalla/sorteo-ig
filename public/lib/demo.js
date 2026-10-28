// Datos de ejemplo para probar la página sin conectar Instagram.

const FIRST = ['sofi', 'juli', 'mati', 'cami', 'lucas', 'vale', 'nico', 'agus', 'flor', 'tomi', 'mica', 'santi',
  'rochi', 'fran', 'lu', 'guada', 'nacho', 'pili', 'bruno', 'meli', 'joaco', 'ine', 'facu', 'abril'];
const SUFFIX = ['.otaku', '_comics', '.reads', '_99', '.ok', '_ar', '.lee', 'manga', '_fan', '.geek', '23', '_bsas'];

function rand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function demoData() {
  const r = rand(42);
  const choice = (arr) => arr[Math.floor(r() * arr.length)];
  const users = [...new Set(Array.from({ length: 90 }, () => choice(FIRST) + choice(SUFFIX)))];
  const friend = () => choice(users);
  const comments = [];
  let t = 1_730_000_000;
  const add = (username, text, isReply = false) =>
    comments.push({ id: `demo-${comments.length}`, username, text, createdAt: (t += 37), isReply, profilePic: '' });

  for (const user of users) {
    const roll = r();
    const word = roll < 0.45 ? 'comic' : roll < 0.8 ? 'manga' : 'comic y manga';
    const tags = Array.from({ length: 1 + Math.floor(r() * 3) }, friend).map((u) => `@${u}`).join(' ');
    add(user, `${choice(['Quiero el', 'Participo por el', 'Ojalá gane el', '', 'Me encanta!'])} ${word} ${tags}`.trim());
    if (r() < 0.35) add(user, `${word} ${Array.from({ length: 2 }, friend).map((u) => `@${u}`).join(' ')}`);
    if (r() < 0.15) add(user, comments[comments.length - 1].text); // repetido
    if (r() < 0.1) add(user, `${choice(['Suerte a todos!', 'Qué lindo', '🔥🔥🔥'])}`);
  }
  add('tienda.demo', 'Gracias a todos por participar! 🙌');
  add(users[3], `@${users[5]} mirá esto, comic`, true);

  const like = new Set(users.filter(() => r() < 0.88));
  const follow = new Set(users.filter(() => r() < 0.85));

  return {
    post: {
      id: 'demo',
      code: 'DEMO',
      owner: { username: 'tienda.demo', fullName: 'Tienda Demo Cómics & Manga', profilePic: '' },
      caption:
        '🎁 ¡SORTEO! Regalamos un cómic y un manga a elección.\n' +
        'Para participar: seguinos, dale like y comentá "comic" o "manga" (o los dos) etiquetando a un amigo. ' +
        'Podés comentar todas las veces que quieras etiquetando gente diferente.',
      commentCount: comments.length,
      likeCount: like.size,
      image: '',
      url: '',
    },
    comments,
    checks: { like, follow },
  };
}

/**
 * Logins que podem alterar e criar campanhas no Google pelo Autometrics.
 * Fica num arquivo à parte para a tela também poder perguntar (o servidor
 * confere de novo em toda rota).
 */
const EDITORS = ['dcalmeida431@gmail.com', 'daniel.camiloalm@gmail.com'];
export const canEdit = (email?: string | null) => !!email && EDITORS.includes(email.trim().toLowerCase());

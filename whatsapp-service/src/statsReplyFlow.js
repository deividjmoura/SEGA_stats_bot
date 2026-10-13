// O retorno do !stats nunca deve esperar pelos endpoints opcionais da temporada.
// A ficha antiga sai primeiro; um complemento é enviado somente quando houver dados.
export async function sendStatsWithOptionalSeason(sendBase, loadExtra, sendExtra, onExtraError = () => {}) {
  await sendBase();
  if (!loadExtra) return;
  try {
    const extra = await loadExtra();
    if (Array.isArray(extra) && extra.length) await sendExtra(extra);
  } catch (error) {
    onExtraError(error);
  }
}

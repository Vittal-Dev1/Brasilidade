const _store = {
  replyMessage: "Oi {{nome}}, recebemos sua mensagem e logo retornaremos 👋",
  names: new Map<string, string>(),
};

export function setReplyMessage(msg: string) {
  _store.replyMessage = msg || _store.replyMessage;
}
export function getReplyMessage() {
  return _store.replyMessage;
}

export function setContactName(number: string, name: string) {
  if (!number) return;
  _store.names.set(number, name);
}

export function getContactName(number: string) {
  return _store.names.get(number);
}

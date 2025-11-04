// src/app/lib/uazapi.ts

export type EnviarMensagemOptions = {
  queueId?: string;
  userId?: string;
};

interface SendTextPayload {
  number: string;
  text: string;           // endpoint /send/text espera "text"
  queueId?: string;
  userId?: string;
}

export async function enviarMensagem(
  number: string,
  message: string,
  opts: EnviarMensagemOptions = {}
): Promise<void> {
  const apiURL = process.env.UAZAPIGO_API_URL;
  const token = process.env.UAZAPIGO_TOKEN;

  if (!apiURL) throw new Error("UAZAPIGO_API_URL não configurado");
  if (!token) throw new Error("UAZAPIGO_TOKEN não configurado");

  const payload: SendTextPayload = {
    number,
    text: message,
    ...(opts.queueId ? { queueId: opts.queueId } : {}),
    ...(opts.userId ? { userId: opts.userId } : {}),
  };

  const res = await fetch(apiURL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      // sua instância exige header `token` (não Authorization)
      token,
    } as Record<string, string>,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    // log de servidor para facilitar debug
    console.error("UazapiGO erro:", res.status, text);
    throw new Error(`Falha ao enviar para ${number}: ${res.status} ${text}\n`);
  }

  // sucesso
  console.log("UazapiGO OK ->", number);
}

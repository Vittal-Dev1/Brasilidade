import axios from 'axios';

const apiURL = process.env.UAZAPIGO_API_URL!;
const token = process.env.UAZAPIGO_TOKEN!;

export async function enviarMensagem(numero: string, mensagem: string) {
  const payload = {
    number: numero,
    body: mensagem,
  };

  await axios.post(apiURL, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

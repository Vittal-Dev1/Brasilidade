export function onlyDigits(s: string) {
  return s.replace(/\D/g, "");
}

/**
 * Normaliza para E.164 Brasil com DDI 55 e insere '9' onde faltar (celular).
 * Regras simples e conservadoras:
 * - Se começar com 55 e tiver 12 dígitos após DDI (55 + 2 DDD + 8), insere '9' após os 4 primeiros.
 * - Se começar com 55 e já tiver 13 dígitos (55 + 2 DDD + 9), mantém.
 * - Se vier sem DDI e tiver 10 dígitos (DDD + 8), insere '9' após DDD.
 * - Se vier sem DDI e tiver 11 dígitos (DDD + 9), mantém e adiciona 55.
 */
export function normalizeBR(raw: string): string {
  let num = onlyDigits(raw);

  // sem DDI
  if (!num.startsWith("55")) {
    if (num.length === 10) {
      // DDD+8 -> insere 9
      num = "55" + num.slice(0, 2) + "9" + num.slice(2);
    } else if (num.length === 11) {
      // DDD+9 -> ok
      num = "55" + num;
    } else if (num.length >= 12 && num.length <= 13) {
      // caso raro: já veio com DDI mas sem 55, ou formatos diversos
      // como fallback, adiciona 55 se não houver
      if (!num.startsWith("55")) num = "55" + num.slice(-11);
    } else if (num.length < 10) {
      // insuficiente — retorna como está (a API pode rejeitar)
      return num;
    } else {
      // pega os últimos 11 (DDD+9) e adiciona 55
      num = "55" + num.slice(-11);
    }
  } else {
    // já tem 55
    if (num.length === 12) {
      // 55 + DDD(2) + 8 -> insere '9' após 55DD
      num = num.slice(0, 4) + "9" + num.slice(4);
    } else if (num.length === 13) {
      // 55 + DDD(2) + 9 -> ok
    } else if (num.length > 13) {
      // pega os últimos 13
      num = "55" + num.slice(-11);
    }
  }

  return num;
}

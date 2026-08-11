// ============================================================
// notes.js
// Responsável por: transformar uma frequência (em Hz) na nota
// musical mais próxima, usando a matemática da escala temperada.
// ============================================================

const NOMES = ["Dó", "Dó#", "Ré", "Ré#", "Mi", "Fá", "Fá#", "Sol", "Sol#", "Lá", "Lá#", "Si"];
const SIMBOLOS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FREQUENCIA_LA4 = 440;

/**
 * Encontra a nota musical mais próxima de uma frequência dada.
 *
 * Na escala temperada, cada semitom = frequência anterior × 2^(1/12).
 * Subir 12 semitons (1 oitava) sempre dobra a frequência.
 *
 * semitons = 12 * log2(f / 440)
 */
export function encontrar_nota(frequencia) {
    if (!frequencia || frequencia <= 0 || !isFinite(frequencia)) {
        return null;
    }

    const semitonsDeLa4 = 12 * Math.log2(frequencia / FREQUENCIA_LA4);
    const semitonsArredondado = Math.round(semitonsDeLa4);

    let indice = (semitonsArredondado + 9) % 12;
    if (indice < 0) indice += 12;

    const oitava = 4 + Math.floor((semitonsArredondado + 9) / 12);

    const frequenciaEsperada = FREQUENCIA_LA4 * Math.pow(2, semitonsArredondado / 12);

    const diferencaCents = Math.round((semitonsDeLa4 - semitonsArredondado) * 100);

    return {
        nome: NOMES[indice],
        simbolo: SIMBOLOS[indice] + oitava,
        frequenciaEsperada: Number(frequenciaEsperada.toFixed(2)),
        diferencaCents
    };
}
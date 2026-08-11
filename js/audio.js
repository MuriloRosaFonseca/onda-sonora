// ============================================================
// audio.js
// Responsável por: acessar o microfone, expor a onda sonora
// captada, e calcular a frequência dessa onda (autocorrelação).
// ============================================================

let audioContext = null;
let microfone = null;
let analyser = null;

export async function iniciarMicrofone() {
    try {
        // Pedimos o microfone SEM os processamentos padrão de chamada de
        // voz (cancelamento de eco, supressão de ruído, ganho automático).
        // Esses filtros são otimizados pra fala e podem suprimir ou
        // distorcer sons puros e sustentados — como as notas agudas de
        // uma flauta doce — tratando-os como ruído/feedback antes mesmo
        // de o áudio chegar até aqui.
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });
        audioContext = new AudioContext();

        // Alguns navegadores criam o AudioContext em estado "suspended"
        // (sobretudo quando há um await entre o clique do usuário e essa
        // criação). Se isso acontecer, o áudio nunca é processado e o
        // buffer fica parado em zero — a onda aparece "reta" na tela mesmo
        // com o microfone tecnicamente ativo. Forçamos o resume aqui.
        if (audioContext.state === "suspended") {
            await audioContext.resume();
        }

        microfone = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        microfone.connect(analyser);
        analyser.fftSize = 2048;

        const faixaUsada = stream.getAudioTracks()[0];
        console.log("Iniciou o microfone:", faixaUsada?.label, "| Estado do AudioContext:", audioContext.state);
        return true;
    } catch (erro) {
        console.error(erro);
        alert("Ocorreu um erro ao iniciar o microfone.");
        return false;
    }
}

export function getAnalyser() {
    return analyser;
}

export function getAudioContext() {
    return audioContext;
}

export function getWaveformBuffer() {
    if (!analyser) return null;
    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);
    return buffer;
}

/**
 * Detecta a frequência fundamental de um sinal de áudio usando AUTOCORRELAÇÃO.
 *
 * A ideia: um som periódico (como uma nota musical) se repete a cada
 * "período" de tempo. Se pegarmos a onda captada e a compararmos com uma
 * cópia dela mesma deslocada (offset) no tempo, o deslocamento em que elas
 * mais se parecem é justamente o período da onda.
 *
 * E frequência = sampleRate / período (em número de amostras).
 */
export function detectarFrequencia(buffer, sampleRate, opcoes = {}) {
    const frequenciaMinima = opcoes.frequenciaMinima || 60;
    const frequenciaMaxima = opcoes.frequenciaMaxima || 1500;
    const tamanho = buffer.length;

    let somaQuadrados = 0;
    for (let i = 0; i < tamanho; i++) {
        somaQuadrados += buffer[i] * buffer[i];
    }
    const volumeRMS = Math.sqrt(somaQuadrados / tamanho);
    if (volumeRMS < 0.01) return null;

    const deslocamentoMinimo = Math.max(1, Math.floor(sampleRate / frequenciaMaxima));
    const deslocamentoMaximo = Math.min(
        Math.floor(tamanho / 2),
        Math.floor(sampleRate / frequenciaMinima)
    );

    let melhorDeslocamento = -1;
    let melhorCorrelacao = 0;

    for (let deslocamento = deslocamentoMinimo; deslocamento <= deslocamentoMaximo; deslocamento++) {
        let diferenca = 0;
        const amostrasComparadas = tamanho - deslocamento;
        for (let i = 0; i < amostrasComparadas; i++) {
            diferenca += Math.abs(buffer[i] - buffer[i + deslocamento]);
        }
        const correlacao = 1 - diferenca / amostrasComparadas;
        if (correlacao > melhorCorrelacao) {
            melhorCorrelacao = correlacao;
            melhorDeslocamento = deslocamento;
        }
    }

    if (melhorCorrelacao < 0.85 || melhorDeslocamento <= 0) return null;

    return sampleRate / melhorDeslocamento;
}
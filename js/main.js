// ============================================================
// main.js — Propagação de Ondas Sonoras
// ============================================================

import { iniciarMicrofone, getAudioContext, getWaveformBuffer, detectarFrequencia } from "./audio.js";
import { encontrar_nota } from "./notes.js";

// ─── ESTADO ──────────────────────────────────────────────────
const estado = {
    instrumentoOrdem: [],
    capturaAtiva: false,
    loopId: null,
    resultados: { violao: null, flauta: null },
};

// Estado de detecção por canal
function criarDeteccao() {
    return {
        hzBuffer: [],
        notaBuffer: [],
        ultimaNota: null,
        ultimaFreq: null,
        ultimaExibida: null,
        tUltimaNota: null,
        picoRMS: 0,
    };
}
const det = { 0: criarDeteccao(), 1: criarDeteccao() };

// ─── CONSTANTES DETECÇÃO ─────────────────────────────────────
const DET_JANELA = 12;  // janela de suavização/votação
const DET_VOTOS = 10;  // votos mínimos para confirmar nota (~85%)

// ─── SVG ICONS ───────────────────────────────────────────────
const ICONES_SVG = {
    violao: `<svg viewBox="0 0 36 44" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <rect x="13.5" y="1" width="9" height="4" rx="2"/>
    <rect x="15.5" y="5" width="5" height="12" rx="1"/>
    <path d="M15.5 17 Q9 18 9 22 Q9 25 11 25.5 Q9 26 9 30 Q9 37 18 38 Q27 37 27 30 Q27 26 25 25.5 Q27 25 27 22 Q27 18 20.5 17 Z"/>
    <circle cx="18" cy="28.5" r="3"/>
    <line x1="16.8" y1="5.5" x2="16.8" y2="38" stroke-width="0.9" opacity="0.45"/>
    <line x1="19.2" y1="5.5" x2="19.2" y2="38" stroke-width="0.9" opacity="0.45"/>
  </svg>`,
    flauta: `<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
    <rect x="2" y="14.5" width="32" height="7" rx="3.5"/>
    <ellipse cx="6.5" cy="18" rx="2" ry="2.6" stroke-width="1.5"/>
    <circle cx="14" cy="18" r="1.6"/>
    <circle cx="20" cy="18" r="1.6"/>
    <circle cx="26" cy="18" r="1.6"/>
  </svg>`,
};
const NOMES = { violao: "Violão", flauta: "Flauta" };

// ─── ELEMENTOS ───────────────────────────────────────────────
const el = {
    sidebarE1: document.getElementById("sidebar-etapa1"),
    sidebarE2: document.getElementById("sidebar-etapa2"),
    sidebarE3: document.getElementById("sidebar-etapa3"),
    sidebarTit2: document.getElementById("sidebar-titulo-etapa2"),
    sidebarNota: document.getElementById("sidebar-nota"),
    sidebarFreq: document.getElementById("sidebar-freq"),
    sidebarCents: document.getElementById("sidebar-cents"),
    sidebarStatus: document.getElementById("sidebar-status-mic"),
    btnComecar: document.getElementById("btn-comecar"),
    btnMic: document.getElementById("btn-ativar-mic"),
    btnProximo: document.getElementById("btn-proximo"),
    btnProxLabel: document.getElementById("btn-proximo-label"),
    btnRecomecar: document.getElementById("btn-recomecar"),
    resNota1: document.getElementById("res-nota1"),
    resNota2: document.getElementById("res-nota2"),
    nomeInst1: document.getElementById("nome-inst1"),
    nomeInst2: document.getElementById("nome-inst2"),

    telaEscolha: document.getElementById("tela-escolha"),
    telaCaptura: document.getElementById("tela-captura"),
    telaCaptura2: document.getElementById("tela-captura2"),

    // Captura 1
    capturaIcon: document.getElementById("captura-icon"),
    capturaTit: document.getElementById("captura-titulo"),
    notaDisplay: document.getElementById("nota-display"),
    simDisplay: document.getElementById("simbolo-display"),
    freqDisplay: document.getElementById("freq-display"),
    centsBarra: document.getElementById("cents-barra"),
    centsTxt: document.getElementById("cents-texto"),
    notaTs1: document.getElementById("nota-ts-1"),
    swSilence1: document.getElementById("sw-silence-1"),
    canvas1: document.getElementById("visualizador"),

    // Captura 2
    capturaIcon2: document.getElementById("captura-icon2"),
    capturaTit2: document.getElementById("captura-titulo2"),
    notaDisplay2: document.getElementById("nota-display2"),
    simDisplay2: document.getElementById("simbolo-display2"),
    freqDisplay2: document.getElementById("freq-display2"),
    centsBarra2: document.getElementById("cents-barra2"),
    centsTxt2: document.getElementById("cents-texto2"),
    notaTs2: document.getElementById("nota-ts-2"),
    swSilence2: document.getElementById("sw-silence-2"),
    canvas2: document.getElementById("visualizador2"),

    compVazio: document.getElementById("comparativo-vazio"),
    compDados: document.getElementById("comparativo-dados"),
};

// ─── UTILS ───────────────────────────────────────────────────
// buffer é Float32Array (-1..1) vindo de getFloatTimeDomainData
function calcularRMS(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    return Math.sqrt(sum / buffer.length);
}

function formatarPT(numero, casas = 2) {
    return numero.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function formatarTempoDecorrido(ts) {
    if (!ts) return "";
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 4) return "agora há pouco";
    if (s < 60) return `há ${s}s`;
    return `há ${Math.floor(s / 60)}min`;
}

// ─── ESTABILIZAÇÃO DE NOTA ───────────────────────────────────
// Suaviza Hz por média móvel e só confirma uma nota quando
// ela aparece em ≥ DET_VOTOS dos últimos DET_JANELA frames.
function processarDeteccao(d, hz) {
    if (!hz) {
        d.hzBuffer = [];
        d.notaBuffer = [];
        return { hzSmooth: null, novaNotaEstavel: false, notaEstavel: null };
    }

    // Suavização por média móvel
    d.hzBuffer.push(hz);
    if (d.hzBuffer.length > DET_JANELA) d.hzBuffer.shift();
    const hzSmooth = d.hzBuffer.reduce((a, b) => a + b, 0) / d.hzBuffer.length;

    const nota = encontrar_nota(hzSmooth);
    if (!nota) return { hzSmooth, novaNotaEstavel: false, notaEstavel: d.ultimaNota };

    d.notaBuffer.push(nota.simbolo);
    if (d.notaBuffer.length > DET_JANELA) d.notaBuffer.shift();
    if (d.notaBuffer.length < DET_JANELA) {
        return { hzSmooth, novaNotaEstavel: false, notaEstavel: d.ultimaNota };
    }

    // Votação por maioria
    const contagem = {};
    d.notaBuffer.forEach(s => { contagem[s] = (contagem[s] || 0) + 1; });
    const [maisSim, maisCount] = Object.entries(contagem)
        .sort((a, b) => b[1] - a[1])[0] || ["", 0];

    if (maisCount < DET_VOTOS) {
        return { hzSmooth, novaNotaEstavel: false, notaEstavel: d.ultimaNota };
    }

    const notaEstavel = encontrar_nota(hzSmooth);
    if (!notaEstavel || notaEstavel.simbolo !== maisSim) {
        return { hzSmooth, novaNotaEstavel: false, notaEstavel: d.ultimaNota };
    }

    const novaNotaEstavel = !d.ultimaNota || d.ultimaNota.simbolo !== maisSim;
    d.ultimaNota = notaEstavel;
    d.ultimaFreq = hzSmooth;
    d.tUltimaNota = Date.now();

    return { hzSmooth, novaNotaEstavel, notaEstavel };
}

// ─── OSCILOSCÓPIO ────────────────────────────────────────────
// Desenha o buffer de forma de onda como linha contínua
// com gradiente cyan → purple (amplitudes altas).
function desenharOnda(canvas, buffer, rms) {
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 600;
    const H = canvas.clientHeight || 180;
    if (canvas.width !== Math.round(W * dpr) ||
        canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
    }

    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    // Fundo
    ctx.fillStyle = "#241a10";
    ctx.fillRect(0, 0, W, H);

    // Linha central de referência
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();

    if (!buffer || buffer.length === 0) {
        ctx.restore();
        return;
    }

    // Onda com gradiente baseado na amplitude local (tons dourados da paleta)
    const amp = Math.min(rms * 6, 1);            // 0..1 para cor
    const calmR = 168, calmG = 117, calmB = 43;   // dourado suave (calmo)
    const loudR = 224, loudG = 154, loudB = 60;   // âmbar vivo (som mais forte)
    const r = Math.round(calmR + (loudR - calmR) * amp);
    const g = Math.round(calmG + (loudG - calmG) * amp);
    const b = Math.round(calmB + (loudB - calmB) * amp);

    const grd = ctx.createLinearGradient(0, 0, W, 0);
    grd.addColorStop(0, `rgba(${r},${g},${b},0.3)`);
    grd.addColorStop(0.5, `rgba(${r},${g},${b},1.0)`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0.3)`);

    ctx.strokeStyle = grd;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.shadowColor = `rgba(${r},${g},${b},0.6)`;
    ctx.shadowBlur = 8;

    ctx.beginPath();
    const step = W / buffer.length;
    const scale = H / 2 * 0.85;
    for (let i = 0; i < buffer.length; i++) {
        const x = i * step;
        const y = H / 2 - buffer[i] * scale;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Preenchimento suave abaixo da onda
    ctx.shadowBlur = 0;
    const fill = ctx.createLinearGradient(0, 0, 0, H);
    fill.addColorStop(0, `rgba(${r},${g},${b},${(amp * 0.18).toFixed(3)})`);
    fill.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fill;
    ctx.lineTo(W, H / 2);
    ctx.lineTo(0, H / 2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

// ─── ETAPA 1 — SELEÇÃO ───────────────────────────────────────
document.getElementById("card-violao").addEventListener("click", () => selecionarInstrumento("violao"));
document.getElementById("card-flauta").addEventListener("click", () => selecionarInstrumento("flauta"));

function selecionarInstrumento(inst) {
    document.querySelectorAll(".card-instrumento").forEach(c => c.classList.remove("selecionado"));
    document.getElementById("card-" + inst).classList.add("selecionado");
    estado.instrumentoOrdem = [inst, inst === "violao" ? "flauta" : "violao"];
    el.btnComecar.disabled = false;
}

el.btnComecar.addEventListener("click", () => {
    if (!estado.instrumentoOrdem.length) return;
    irParaCaptura(0);
});

// ─── ETAPA 2 — CAPTURA ───────────────────────────────────────
async function irParaCaptura(indice) {
    const inst = estado.instrumentoOrdem[indice];
    const ehPrimeiro = indice === 0;

    el.sidebarE1.style.display = "none";
    el.sidebarE2.style.display = "";
    el.sidebarE3.style.display = "none";
    el.sidebarTit2.textContent = `Capturando ${NOMES[inst]}`;
    el.sidebarNota.textContent = "--";
    el.sidebarFreq.textContent = "-- Hz";
    el.sidebarCents.textContent = "-- ¢";
    el.sidebarStatus.textContent = "Aguardando microfone...";
    el.btnMic.disabled = false;
    el.btnProximo.disabled = true;
    el.btnProxLabel.textContent = ehPrimeiro ? "Próximo instrumento" : "Ver comparativo";

    el.telaEscolha.style.display = "none";
    el.telaCaptura.style.display = ehPrimeiro ? "" : "none";
    el.telaCaptura2.style.display = ehPrimeiro ? "none" : "";

    const icon = ehPrimeiro ? el.capturaIcon : el.capturaIcon2;
    const tit = ehPrimeiro ? el.capturaTit : el.capturaTit2;
    icon.innerHTML = ICONES_SVG[inst];
    tit.textContent = `Tocando ${NOMES[inst]}`;

    // Zera displays
    const notaEl = ehPrimeiro ? el.notaDisplay : el.notaDisplay2;
    const simEl = ehPrimeiro ? el.simDisplay : el.simDisplay2;
    const freqEl = ehPrimeiro ? el.freqDisplay : el.freqDisplay2;
    const tsEl = ehPrimeiro ? el.notaTs1 : el.notaTs2;
    notaEl.textContent = "--";
    simEl.textContent = "--";
    freqEl.textContent = "-- Hz";
    if (tsEl) tsEl.textContent = "";

    estado.capturaAtiva = false;
    if (estado.loopId) { cancelAnimationFrame(estado.loopId); estado.loopId = null; }

    // Reseta detecção para este canal
    det[indice] = criarDeteccao();

    trocarAba("captura");

    el.btnMic.onclick = () => ativarMicrofonePara(indice);
    el.btnProximo.onclick = () => {
        estado.capturaAtiva = false;
        if (estado.loopId) { cancelAnimationFrame(estado.loopId); estado.loopId = null; }
        if (ehPrimeiro) irParaCaptura(1);
        else mostrarComparativo();
    };
}

async function ativarMicrofonePara(indice) {
    const inst = estado.instrumentoOrdem[indice];
    const ehPrimeiro = indice === 0;

    el.sidebarStatus.textContent = "Solicitando acesso ao microfone...";
    el.btnMic.disabled = true;

    // Verificar permissão antes de chamar — evita alert genérico do audio.js
    // quando já sabemos que está negado
    if (navigator.permissions) {
        try {
            const perm = await navigator.permissions.query({ name: "microphone" });
            if (perm.state === "denied") {
                el.sidebarStatus.innerHTML =
                    'Microfone bloqueado. Clique no cadeado na barra de endereço e permita o microfone.';
                el.btnMic.disabled = false;
                return;
            }
        } catch (_) { /* navegador pode não suportar — ignora */ }
    }

    // Interceptar console.error E window.alert do audio.js — captura erro real
    // e suprime o alert genérico (nossa mensagem na sidebar é mais informativa)
    let erroReal = null;
    const origError = console.error.bind(console);
    const origAlert = window.alert.bind(window);
    console.error = (...args) => { erroReal = args[0]; origError(...args); };
    window.alert = () => { }; // suprime o alert genérico do audio.js

    const ok = await iniciarMicrofone();

    // Restaurar comportamento original
    console.error = origError;
    window.alert = origAlert;

    if (!ok) {
        let msg = "Erro ao acessar o microfone.";
        if (erroReal) {
            const nome = erroReal?.name || "";
            if (nome === "NotAllowedError" || nome === "PermissionDeniedError") {
                msg = 'Permissão negada. Clique no cadeado na barra de endereço e permita o microfone.';
            } else if (nome === "NotFoundError" || nome === "DevicesNotFoundError") {
                msg = "Microfone não encontrado. Verifique se há um microfone conectado.";
            } else if (nome === "NotReadableError" || nome === "TrackStartError") {
                msg = "Microfone em uso por outro programa. Feche outros apps e tente novamente.";
            } else if (nome === "OverconstrainedError") {
                msg = "Restrições de áudio não suportadas. Recarregue e tente novamente.";
            } else if (nome === "SecurityError") {
                msg = "Bloqueado por política de segurança. Use http://localhost (não 127.0.0.1).";
            } else {
                msg = `Erro: ${nome || erroReal?.message || "desconhecido"}. Recarregue e tente novamente.`;
            }
        }
        el.sidebarStatus.innerHTML = msg;
        el.btnMic.disabled = false;
        return;
    }
    el.sidebarStatus.textContent = `Microfone ativo — toque o ${NOMES[inst]}!`;
    estado.capturaAtiva = true;

    const ctx2 = getAudioContext();
    const canvas = ehPrimeiro ? el.canvas1 : el.canvas2;
    const notaEl = ehPrimeiro ? el.notaDisplay : el.notaDisplay2;
    const simEl = ehPrimeiro ? el.simDisplay : el.simDisplay2;
    const freqEl = ehPrimeiro ? el.freqDisplay : el.freqDisplay2;
    const barrEl = ehPrimeiro ? el.centsBarra : el.centsBarra2;
    const txtEl = ehPrimeiro ? el.centsTxt : el.centsTxt2;
    const silEl = ehPrimeiro ? el.swSilence1 : el.swSilence2;
    const d = det[indice];

    const opcoes = inst === "violao"
        ? { frequenciaMinima: 60, frequenciaMaxima: 1200 }
        : { frequenciaMinima: 200, frequenciaMaxima: 2500 };

    function loop() {
        if (!estado.capturaAtiva) return;

        const wfBuf = getWaveformBuffer();

        if (wfBuf) {
            const rms = calcularRMS(wfBuf);
            const hz = detectarFrequencia(wfBuf, ctx2.sampleRate, opcoes);

            // Oculta mensagem de silêncio quando há sinal
            if (silEl) silEl.classList.toggle("hidden", rms > 0.025);

            // Desenha osciloscópio com o buffer real
            desenharOnda(canvas, wfBuf, rms);

            // Processa detecção estabilizada
            const res = processarDeteccao(d, hz);

            // Sidebar: atualização em tempo real (sem estabilização)
            if (hz) {
                const notaRaw = encontrar_nota(hz);
                if (notaRaw) {
                    el.sidebarNota.textContent = `${notaRaw.nome} (${notaRaw.simbolo})`;
                    el.sidebarFreq.textContent = `${hz.toFixed(1)} Hz`;
                    el.sidebarCents.textContent = `${notaRaw.diferencaCents > 0 ? "+" : ""}${notaRaw.diferencaCents} ¢`;
                }
            }

            // Display principal: atualiza em tempo real COM suavização (hzSmooth)
            if (res.hzSmooth) {
                const notaSmooth = res.notaEstavel;
                if (notaSmooth) {
                    const mudou = !d.ultimaExibida || d.ultimaExibida !== notaSmooth.simbolo;
                    notaEl.textContent = notaSmooth.nome;
                    simEl.textContent = notaSmooth.simbolo;
                    freqEl.textContent = `${res.hzSmooth.toFixed(2)} Hz`;
                    atualizarCents(notaSmooth.diferencaCents, barrEl, txtEl);

                    if (mudou) {
                        d.ultimaExibida = notaSmooth.simbolo;
                        d.picoRMS = 0;
                        notaEl.classList.remove("nota-pulse");
                        void notaEl.offsetWidth;
                        notaEl.classList.add("nota-pulse");
                    }

                    el.btnProximo.disabled = false;

                    if (rms > d.picoRMS) {
                        d.picoRMS = rms;
                        estado.resultados[inst] = { nota: notaSmooth, freq: res.hzSmooth };
                    }
                }
            }

            // Confirma nota estável quando há votos suficientes (para exibição de timestamp)
            if (res.novaNotaEstavel) {
                d.tUltimaNota = Date.now();
            }

        } else {
            // Sem buffer: limpa tela
            desenharOnda(canvas, null, 0);
        }

        estado.loopId = requestAnimationFrame(loop);
    }

    estado.loopId = requestAnimationFrame(loop);
}

// Atualiza timestamps a cada segundo
setInterval(() => {
    if (el.notaTs1 && det[0].tUltimaNota) el.notaTs1.textContent = formatarTempoDecorrido(det[0].tUltimaNota);
    if (el.notaTs2 && det[1].tUltimaNota) el.notaTs2.textContent = formatarTempoDecorrido(det[1].tUltimaNota);
}, 1000);

// ─── BARRA DE CENTS ──────────────────────────────────────────
function atualizarCents(cents, barrEl, txtEl) {
    const pct = Math.min(Math.abs(cents) / 50, 1) * 50;
    if (cents >= 0) {
        barrEl.style.left = "50%";
        barrEl.style.width = pct + "%";
    } else {
        barrEl.style.left = (50 - pct) + "%";
        barrEl.style.width = pct + "%";
    }
    if (txtEl) txtEl.textContent = `${cents > 0 ? "+" : ""}${cents} ¢`;
}

// ─── ETAPA 3 — COMPARATIVO ───────────────────────────────────
function mostrarComparativo() {
    el.sidebarE2.style.display = "none";
    el.sidebarE3.style.display = "";

    const [inst1, inst2] = estado.instrumentoOrdem;
    el.nomeInst1.textContent = NOMES[inst1];
    el.nomeInst2.textContent = NOMES[inst2];

    preencherCardComp(inst1, "1");
    preencherCardComp(inst2, "2");
    gerarAnalise();
    atualizarSegmentoAureo();

    el.compVazio.style.display = "none";
    el.compDados.style.display = "";
    trocarAba("comparativo");
}

function preencherCardComp(inst, sufixo) {
    const r = estado.resultados[inst];
    document.getElementById("comp-icon-" + sufixo).innerHTML = ICONES_SVG[inst];
    document.getElementById("comp-nome-" + sufixo).textContent = NOMES[inst];

    if (r?.nota) {
        document.getElementById("comp-nota-" + sufixo).textContent = r.nota.nome;
        document.getElementById("comp-simbolo-" + sufixo).textContent = r.nota.simbolo;
        document.getElementById("comp-freq-" + sufixo).textContent = `${r.freq.toFixed(2)} Hz`;
        document.getElementById("comp-freqe-" + sufixo).textContent = `${r.nota.frequenciaEsperada} Hz`;
        const c = r.nota.diferencaCents;
        document.getElementById("comp-cents-" + sufixo).textContent = `${c > 0 ? "+" : ""}${c} ¢`;
    } else {
        ["nota", "simbolo", "freq", "freqe", "cents"].forEach(k =>
            (document.getElementById(`comp-${k}-${sufixo}`).textContent = "--"));
    }
}

function atualizarSegmentoAureo() {
    const [inst1, inst2] = estado.instrumentoOrdem;
    const r1 = estado.resultados[inst1];
    const r2 = estado.resultados[inst2];

    const menorEl = document.getElementById("aureo-menor");
    const maiorEl = document.getElementById("aureo-maior");
    const razaoEl = document.getElementById("aureo-razao");
    const razao2El = document.getElementById("aureo-razao-2");
    const diferencaEl = document.getElementById("aureo-diferenca");
    const resultadoEl = document.getElementById("aureo-resultado");
    const statusEl = document.getElementById("aureo-status");
    const maiorValorEl = document.getElementById("aureo-parte-maior-valor");
    const menorValorEl = document.getElementById("aureo-parte-menor-valor");
    const totalEl = document.getElementById("aureo-total");
    const relatorioEl = document.getElementById("relatorio-aureo");

    if (!r1?.freq || !r2?.freq) {
        [menorEl, maiorEl, razaoEl, razao2El, diferencaEl, maiorValorEl, menorValorEl].forEach(el => {
            if (el) el.textContent = "--";
        });
        if (resultadoEl) resultadoEl.textContent = "Complete as duas capturas para calcular a relação.";
        if (statusEl) statusEl.textContent = "Aguardando as frequências dos instrumentos.";
        if (totalEl) totalEl.textContent = "Total: --";
        if (relatorioEl) relatorioEl.innerHTML = '<p class="relatorio-vazio">Complete as duas capturas para gerar o relatório.</p>';
        return;
    }

    const menor = Math.min(r1.freq, r2.freq);
    const maior = Math.max(r1.freq, r2.freq);
    const razao = maior / menor;
    const phi = (1 + Math.sqrt(5)) / 2;
    const diferenca = Math.abs(razao - phi);
    const erroPercentual = (diferenca / phi) * 100;

    menorEl.textContent = `${menor.toFixed(2)} Hz`;
    maiorEl.textContent = `${maior.toFixed(2)} Hz`;
    razaoEl.textContent = razao.toFixed(4);
    razao2El.textContent = razao.toFixed(4);
    diferencaEl.textContent = diferenca.toFixed(4);

    const maiorParte = maior * (phi / (phi + 1));
    const menorParte = maior - maiorParte;

    maiorValorEl.textContent = `${maiorParte.toFixed(2)} Hz`;
    menorValorEl.textContent = `${menorParte.toFixed(2)} Hz`;
    totalEl.textContent = `Total: ${maior.toFixed(2)} Hz`;

    resultadoEl.innerHTML =
        `A razão entre ${maior.toFixed(2)} Hz e ${menor.toFixed(2)} Hz é ` +
        `<strong>${razao.toFixed(4)}</strong>. A razão áurea é <strong>1,618033</strong>.`;

    // Classificação pela diferença absoluta entre a razão encontrada e φ
    // (não pela diferença percentual) — ex.: diferença 1 → "Perfeito",
    // diferença 5 → "OK", acima disso → "Distante".
    let conclusaoCurta, rotulo, rotuloClasse;
    if (diferenca <= 1) {
        rotulo = "Perfeito";
        rotuloClasse = "perfeito";
        conclusaoCurta = "As frequências apresentam uma aproximação muito próxima da razão áurea.";
        statusEl.innerHTML =
            `<strong>Perfeito.</strong> A relação encontrada está muito próxima da razão áurea, com diferença de ` +
            `<strong>${diferenca.toFixed(4)}</strong>.`;
    } else if (diferenca <= 5) {
        rotulo = "OK";
        rotuloClasse = "ok";
        conclusaoCurta = "As frequências apresentam uma aproximação da razão áurea.";
        statusEl.innerHTML =
            `<strong>OK.</strong> A relação encontrada apresenta uma aproximação razoável da razão áurea, com diferença de ` +
            `<strong>${diferenca.toFixed(4)}</strong>.`;
    } else {
        rotulo = "Distante";
        rotuloClasse = "distante";
        conclusaoCurta = "As frequências não apresentam uma aproximação significativa da razão áurea.";
        statusEl.innerHTML =
            `<strong>Distante.</strong> A relação encontrada não coincide com a razão áurea. A diferença é de ` +
            `<strong>${diferenca.toFixed(4)}</strong>. Isso também é um resultado válido: mostra que as frequências medidas não precisam seguir a proporção áurea.`;
    }

    // ── Relatório em formato de card "impresso" ──
    if (relatorioEl) {
        const nota1 = r1.nota ? r1.nota.simbolo.replace("#", "♯") : "--";
        const nota2 = r2.nota ? r2.nota.simbolo.replace("#", "♯") : "--";

        relatorioEl.innerHTML = `
            <div class="relatorio-titulo">Análise das frequências</div>
            <div class="relatorio-instrumentos">
              <div class="relatorio-inst">
                <div class="relatorio-inst-nome">${NOMES[inst1]}</div>
                <div class="relatorio-inst-nota">${nota1}</div>
                <div class="relatorio-inst-freq">${formatarPT(r1.freq)} Hz</div>
              </div>
              <div class="relatorio-inst">
                <div class="relatorio-inst-nome">${NOMES[inst2]}</div>
                <div class="relatorio-inst-nota">${nota2}</div>
                <div class="relatorio-inst-freq">${formatarPT(r2.freq)} Hz</div>
              </div>
            </div>
            <hr class="relatorio-divisor" />
            <div class="relatorio-metricas">
              <div class="relatorio-metrica">
                <span>Razão entre<br>as frequências</span>
                <strong>${formatarPT(razao, 3)}</strong>
              </div>
              <div class="relatorio-metrica">
                <span>Razão Áurea (φ)</span>
                <strong>1,618</strong>
              </div>
              <div class="relatorio-metrica">
                <span>Diferença<br>|razão − φ|</span>
                <strong>${formatarPT(diferenca, 4)}</strong>
                <small>${formatarPT(erroPercentual)}% de desvio</small>
              </div>
            </div>
            <div class="relatorio-classificacao">
              <span class="relatorio-badge ${rotuloClasse}">${rotulo}</span>
            </div>
            <p class="relatorio-conclusao">${conclusaoCurta}</p>
        `;
    }
}

function gerarAnalise() {
    const [inst1, inst2] = estado.instrumentoOrdem;
    const r1 = estado.resultados[inst1];
    const r2 = estado.resultados[inst2];
    let html = "";

    if (r1?.nota && r2?.nota) {
        const mesmaNota = r1.nota.simbolo === r2.nota.simbolo;
        const diffFreq = Math.abs(r1.freq - r2.freq).toFixed(2);
        const diffCents = Math.abs(r1.nota.diferencaCents - r2.nota.diferencaCents);

        html += `<p><strong>Notas detectadas:</strong> `;
        if (mesmaNota) {
            html += `Ambos tocaram <strong>${r1.nota.nome} (${r1.nota.simbolo})</strong> — comparação direta possível.</p>`;
        } else {
            html += `${NOMES[inst1]} → <strong>${r1.nota.nome} (${r1.nota.simbolo})</strong> e ${NOMES[inst2]} → <strong>${r2.nota.nome} (${r2.nota.simbolo})</strong>.</p>`;
        }

        html += `<p><strong>Diferença de frequência:</strong> ${diffFreq} Hz. `;
        html += `Frequência mais alta = mais oscilações por segundo = tom mais agudo.</p>`;

        if (mesmaNota) {
            const maisAf = Math.abs(r1.nota.diferencaCents) < Math.abs(r2.nota.diferencaCents)
                ? NOMES[inst1] : NOMES[inst2];
            html += `<p><strong>Afinação:</strong> O <strong>${maisAf}</strong> estava mais próximo da nota perfeita (diferença entre os dois: ${diffCents} ¢).</p>`;
        }

        html += `<p><strong>Por que as ondas são diferentes?</strong> Mesmo tocando a mesma nota, violão e flauta produzem ondas distintas por causa do <em>timbre</em> — a combinação única de harmônicas que cada instrumento gera. O violão tem harmônicas ricas e complexas; a flauta produz uma onda quase senoidal.</p>`;
        html += `<p><strong>Resumo:</strong><br>`;
        html += `${NOMES[inst1]}: ${r1.freq.toFixed(2)} Hz → ${r1.nota.nome} (${r1.nota.simbolo}) | ${r1.nota.diferencaCents > 0 ? "+" : ""}${r1.nota.diferencaCents} ¢<br>`;
        html += `${NOMES[inst2]}: ${r2.freq.toFixed(2)} Hz → ${r2.nota.nome} (${r2.nota.simbolo}) | ${r2.nota.diferencaCents > 0 ? "+" : ""}${r2.nota.diferencaCents} ¢</p>`;
    } else {
        html += `<p>Capture os dois instrumentos para ver a análise completa.</p>`;
    }

    document.getElementById("comp-analise").innerHTML = html;
    if (r1?.nota) el.resNota1.textContent = `${r1.nota.nome} (${r1.nota.simbolo})`;
    if (r2?.nota) el.resNota2.textContent = `${r2.nota.nome} (${r2.nota.simbolo})`;
}

// ─── RECOMEÇAR ───────────────────────────────────────────────
el.btnRecomecar.addEventListener("click", () => {
    estado.instrumentoOrdem = [];
    estado.capturaAtiva = false;
    estado.resultados = { violao: null, flauta: null };
    if (estado.loopId) { cancelAnimationFrame(estado.loopId); estado.loopId = null; }
    det[0] = criarDeteccao(); det[1] = criarDeteccao();

    document.querySelectorAll(".card-instrumento").forEach(c => c.classList.remove("selecionado"));
    el.btnComecar.disabled = true;

    el.sidebarE1.style.display = "";
    el.sidebarE2.style.display = "none";
    el.sidebarE3.style.display = "none";

    el.telaEscolha.style.display = "";
    el.telaCaptura.style.display = "none";
    el.telaCaptura2.style.display = "none";

    el.compVazio.style.display = "";
    el.compDados.style.display = "none";
    trocarAba("captura");
});

// ─── ABAS ────────────────────────────────────────────────────
window.trocarAba = function (aba) {
    ["captura", "comparativo", "calculos"].forEach(id => {
        document.getElementById("conteudo-" + id).style.display = id === aba ? "" : "none";
        document.getElementById("aba-" + id).classList.toggle("ativa", id === aba);
    });
};
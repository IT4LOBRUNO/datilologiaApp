import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import firebaseConfig from "./config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// CONFIGURAÇÕES
const CONFIG = {
  THRESHOLD_PADRAO: 0.15,
  FRAMES_ESTAVEIS: 5,
  DEBUG_MODE: true
};

// Threshold específico por letra
const THRESHOLD_POR_LETRA = {
  // Letras parecidas
  A: 0.12,
  S: 0.12,

  G: 0.09,
  U: 0.09,

  M: 0.22,
  N: 0.24,

  F: 0.09,
  T: 0.09,

  // Letras tranquilas
  B: 0.08,
  C: 0.18,
  D: 0.15,
  E: 0.12,
  H: 0.17,
  I: 0.09,
  J: 0.18,
  K: 0.16,
  L: 0.18,
  O: 0.17,
  P: 0.15,
  Q: 0.15,
  R: 0.12,
  V: 0.10,
  W: 0.17,
  X: 0.18,
  Y: 0.18,
  Z: 0.24
};

const PESOS_LANDMARKS = [
  0.5,
  1.0, 1.0, 1.2, 2.0,
  1.0, 1.0, 1.2, 2.0,
  1.0, 1.0, 1.2, 2.0,
  1.0, 1.0, 1.2, 2.0,
  1.0, 1.0, 1.2, 2.0
];

// ELEMENTOS DO DOM
const loadingStatus = document.getElementById('loadingStatus');
const gameArea = document.getElementById('gameArea');
const wordImage = document.getElementById('wordImage');
const lettersContainer = document.getElementById('lettersContainer');
const webcam = document.getElementById('webcam');
const canvas = document.getElementById('output_canvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const progressFill = document.getElementById('progressFill');
const celebration = document.getElementById('celebration');
const nextWordBtn = document.getElementById('nextWordBtn');
const debugInfo = document.getElementById('debugInfo');
const currentTarget = document.getElementById('currentTarget');

// ESTADO
let palavrasDatabase = [];
let palavrasRestantes = [];
let alfabetoDatabase = {};
let palavraAtual = null;
let letrasCompletadas = [];
let hands = null;
let isRunning = false;
let estabilidadeBuffer = [];
let ultimoReconhecimento = 0;

const INTERVALO_ENTRE_LETRAS = 800;

// UTILITÁRIOS
function embaralhar(lista) {
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
}

// CARREGAR DADOS DO FIREBASE
async function carregarDados() {
  try {
    // Palavras
    const palavrasSnap = await getDocs(collection(db, 'palavras'));
    palavrasDatabase = [];
    palavrasSnap.forEach(d => palavrasDatabase.push(d.data()));

    // Alfabeto: documento plano por letra
    const alfabetoSnap = await getDocs(collection(db, 'alfabeto'));
    alfabetoDatabase = {};

    for (const docSnap of alfabetoSnap.docs) {
      const letra = docSnap.id.toUpperCase();
      const data = docSnap.data();

      // Extrai todas as amostras (campos amostra_0, amostra_1, ...)
      const amostras = [];
      Object.keys(data).forEach(key => {
        if (key.startsWith('amostra_') && Array.isArray(data[key]) && data[key].length > 0) {
          amostras.push(data[key]);
        }
      });

      // Usa pesosLandmarks do banco se existir, senão usa o padrão local
      const pesosDobanco = Array.isArray(data.pesosLandmarks) ? data.pesosLandmarks : null;

      if (amostras.length === 0) {
        console.warn(`Letra "${letra}" sem amostras.`);
      }

      alfabetoDatabase[letra] = {
        amostras,
        pontosNormalizados: Array.isArray(data.pontosNormalizados) ? data.pontosNormalizados : null,
        pesosLandmarks: pesosDobanco,
        imagemBase64: data.imagemBase64 || null
      };
    }

    // Validações
    if (palavrasDatabase.length === 0) {
      mostrarErro('Nenhuma palavra cadastrada. Use admin.html primeiro.');
      return;
    }

    const letrasComAmostras = Object.values(alfabetoDatabase).filter(l => l.amostras.length > 0).length;
    if (letrasComAmostras === 0) {
      mostrarErro('Nenhuma letra com amostras. Use cadastro-alfabeto1.html primeiro.');
      return;
    }

    console.log(`${letrasComAmostras} letras carregadas com amostras.`);

    loadingStatus.style.display = 'none';
    gameArea.classList.add('active');

  } catch (error) {
    console.error(error);
    mostrarErro('Erro ao carregar dados do Firebase.');
  }
}

function mostrarErro(msg) {
  loadingStatus.textContent = msg;
  loadingStatus.className = 'status error';
}

// NORMALIZAÇÃO
function normalizarPontos(landmarks) {
  if (!landmarks || landmarks.length === 0) return null;

  const palma = landmarks[0];
  const ref = landmarks[9];

  const dx = ref.x - palma.x;
  const dy = ref.y - palma.y;
  const dz = (ref.z || 0) - (palma.z || 0);
  const escala = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (escala < 0.01) return null;

  return landmarks.map(p => ({
    x: (p.x - palma.x) / escala,
    y: (p.y - palma.y) / escala,
    z: ((p.z || 0) - (palma.z || 0)) / escala
  }));
}

// DISTÂNCIA PONDERADA
function calcularDistanciaPonderada(pontosA, pontosB, pesosCustom) {
  if (!pontosA || !pontosB || pontosA.length !== pontosB.length) return Infinity;

  const pesos = pesosCustom || PESOS_LANDMARKS;
  let soma = 0;
  let pesoTotal = 0;

  for (let i = 0; i < pontosA.length; i++) {
    const dx = pontosA[i].x - pontosB[i].x;
    const dy = pontosA[i].y - pontosB[i].y;
    const dz = (pontosA[i].z || 0) - (pontosB[i].z || 0);
    const peso = pesos[i] ?? 1.0;

    soma += peso * Math.sqrt(dx * dx + dy * dy + dz * dz);
    pesoTotal += peso;
  }

  return soma / (pesoTotal || 1);
}

// INICIAR NOVA PALAVRA
function iniciarNovaPalavra() {
  if (palavrasRestantes.length === 0) {
    palavrasRestantes = embaralhar([...palavrasDatabase]);
  }

  palavraAtual = palavrasRestantes.pop();
  letrasCompletadas = new Array(palavraAtual.letras.length).fill(false);

  if (palavraAtual.imagemBase64) {
    wordImage.src = palavraAtual.imagemBase64;
  }

  lettersContainer.innerHTML = '';
  palavraAtual.letras.forEach((letra, index) => {
    const letraData = alfabetoDatabase[letra];
    const imagemSrc = letraData?.imagemBase64
      || `https://placehold.co/130x150/667eea/white?text=${letra}`;

    const box = document.createElement('div');
    box.className = 'letter-box';
    box.innerHTML = `
      <div class="letter-text">${letra}</div>
      <div class="letter-symbol" data-index="${index}">
        <img src="${imagemSrc}" alt="${letra}">
      </div>
    `;
    lettersContainer.appendChild(box);
  });

  ultimoReconhecimento = 0;
  estabilidadeBuffer = [];
  celebration.classList.remove('show');
  atualizarProgresso();
  atualizarLetraAtual();
}

function atualizarLetraAtual() {
  const proximoIndex = letrasCompletadas.findIndex(c => !c);
  if (proximoIndex !== -1) {
    currentTarget.textContent = palavraAtual.letras[proximoIndex];
    currentTarget.classList.remove('waiting');
  } else {
    currentTarget.textContent = 'OK';
  }
}

function atualizarProgresso() {
  const total = letrasCompletadas.length;
  const completadas = letrasCompletadas.filter(c => c).length;
  progressFill.style.width = ((completadas / total) * 100) + '%';

  if (completadas === total) {
    setTimeout(() => celebration.classList.add('show'), 500);
  }
}

function completarLetra(index) {
  if (letrasCompletadas[index]) return;

  letrasCompletadas[index] = true;
  document.querySelector(`[data-index="${index}"]`)?.classList.add('completed');

  ultimoReconhecimento = Date.now();
  currentTarget.classList.add('waiting');
  currentTarget.textContent = '...';

  setTimeout(() => {
    atualizarProgresso();
    atualizarLetraAtual();
  }, INTERVALO_ENTRE_LETRAS);
}

// VERIFICAR SINAL
function verificarGesto(landmarks) {
  const tempoDecorrido = Date.now() - ultimoReconhecimento;
  if (tempoDecorrido < INTERVALO_ENTRE_LETRAS) return;

  const pontosNormalizados = normalizarPontos(landmarks);
  if (!pontosNormalizados) return;

  const proximoIndex = letrasCompletadas.findIndex(c => !c);
  if (proximoIndex === -1) return;

  const letraEsperada = palavraAtual.letras[proximoIndex];
  const letraData = alfabetoDatabase[letraEsperada];

  const thresholdLetra =
    THRESHOLD_POR_LETRA[letraEsperada] ??
    CONFIG.THRESHOLD_PADRAO;

  if (!letraData || letraData.amostras.length === 0) {
    if (CONFIG.DEBUG_MODE) debugInfo.textContent = `"${letraEsperada}" sem amostras`;
    return;
  }

  // Menor distância entre todas as amostras, usando pesos
  const distancia = Math.min(
    ...letraData.amostras.map(a =>
      calcularDistanciaPonderada(pontosNormalizados, a, letraData.pesosLandmarks)
    )
  );

  if (CONFIG.DEBUG_MODE) {
    debugInfo.innerHTML = `
      <strong>Esperando:</strong> ${letraEsperada}<br>
      <strong>Distância:</strong> ${distancia.toFixed(3)} / ${thresholdLetra}<br>
      <strong>Amostras:</strong> ${letraData.amostras.length}<br>
      <strong>Buffer:</strong> ${estabilidadeBuffer.length}/${CONFIG.FRAMES_ESTAVEIS}<br>
      <strong>Status:</strong> ${distancia < thresholdLetra ? 'OK' : 'Longe'}
    `;
  }

  if (distancia < thresholdLetra) {
    estabilidadeBuffer.push(letraEsperada);
    if (estabilidadeBuffer.length >= CONFIG.FRAMES_ESTAVEIS) {
      completarLetra(proximoIndex);
      estabilidadeBuffer = [];
    }
  } else {
    estabilidadeBuffer = [];
  }
}

// MEDIAPIPE
async function carregarMediaPipe() {
  hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });
  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.8,
    minTrackingConfidence: 0.8
  });
  hands.onResults(onResults);
}

async function processLoop() {
  if (!isRunning) return;
  if (webcam.readyState >= 2) {
    await hands.send({ image: webcam });
  }
  requestAnimationFrame(processLoop);
}

function onResults(results) {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const landmarks = results.multiHandLandmarks[0];

    drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
    drawLandmarks(ctx, landmarks, { color: '#FFFFFF', lineWidth: 1, radius: 3 });

    verificarGesto(landmarks);
  } else {
    estabilidadeBuffer = [];
    if (CONFIG.DEBUG_MODE) debugInfo.innerHTML = '<strong>Nenhuma mão detectada</strong>';
  }

  ctx.restore();
}

// CONTROLES
startBtn.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
    });

    webcam.srcObject = stream;
    webcam.onloadedmetadata = () => {
      canvas.width = webcam.videoWidth;
      canvas.height = webcam.videoHeight;
    };

    await carregarMediaPipe();

    isRunning = true;
    startBtn.style.display = 'none';
    stopBtn.style.display = 'inline-block';
    if (CONFIG.DEBUG_MODE) debugInfo.style.display = 'block';

    iniciarNovaPalavra();
    requestAnimationFrame(processLoop);

  } catch (e) {
    mostrarErro('Erro ao acessar a câmera (permissão negada ou indisponível).');
    loadingStatus.style.display = 'block';
  }
});

stopBtn.addEventListener('click', () => location.reload());
nextWordBtn.addEventListener('click', () => iniciarNovaPalavra());

// INICIALIZAR
carregarDados();
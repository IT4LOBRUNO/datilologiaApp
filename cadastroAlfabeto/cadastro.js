import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import firebaseConfig from "../config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// CONFIGURAÇÕES
const ALFABETO           = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const TOTAL_AMOSTRAS     = 5;
const DURACAO_CAPTURA_MS = 2000;
const VERSAO_ALGORITMO   = '2.0';

// ELEMENTOS DO DOM
const alphabetGrid         = document.getElementById('alphabetGrid');
const captureArea          = document.getElementById('captureArea');
const currentLetterDisplay = document.getElementById('currentLetterDisplay');
const webcam               = document.getElementById('webcam');
const canvas               = document.getElementById('output_canvas');
const ctx                  = canvas.getContext('2d');
const captureBtn           = document.getElementById('captureBtn');
const cancelBtn            = document.getElementById('cancelBtn');
const captureStatus        = document.getElementById('captureStatus');
const progressCount        = document.getElementById('progressCount');
const captureProgress      = document.getElementById('captureProgress');
const sampleCounter        = document.getElementById('sampleCounter');
const imageUpload          = document.getElementById('imageUpload');
const previewGrid          = document.getElementById('previewGrid');
const uploadImagesBtn      = document.getElementById('uploadImagesBtn');

// ESTADO
let hands = null;
let isCapturing = false;
let currentLetter = null;
let capturedFrames = [];
let letrasCompletadas = new Set();
let imagensParaUpload = {};

// CRIAR GRID DO ALFABETO
function criarGrid() {
    ALFABETO.forEach(letra => {
        const btn = document.createElement('button');
        btn.className = 'letter-btn';
        btn.textContent = letra;
        btn.dataset.letra = letra;
        btn.addEventListener('click', () => selecionarLetra(letra));
        alphabetGrid.appendChild(btn);
    });
}

// CARREGAR PROGRESSO DO FIREBASE — Opção A
async function carregarProgresso() {
    try {
        for (const letra of ALFABETO) {
            const snap = await getDoc(doc(db, 'alfabeto', letra));
            if (snap.exists()) {
                const numAmostras = snap.data().numAmostras || 0;
                if (numAmostras >= TOTAL_AMOSTRAS) {
                    letrasCompletadas.add(letra);
                    marcarLetraCompleta(letra);
                } else if (numAmostras > 0) {
                    marcarLetraParcial(letra, numAmostras);
                }
            }
        }
        atualizarProgresso();
    } catch (error) {
        console.error('Erro ao carregar progresso:', error);
    }
}

function marcarLetraCompleta(letra) {
    const btn = document.querySelector(`[data-letra="${letra}"]`);
    if (btn) { btn.classList.add('completed'); btn.classList.remove('partial'); }
}

function marcarLetraParcial(letra, count) {
    const btn = document.querySelector(`[data-letra="${letra}"]`);
    if (btn) { btn.classList.add('partial'); btn.dataset.count = count; }
}

function atualizarProgresso() {
    progressCount.textContent = `${letrasCompletadas.size}/26`;
}

// SELECIONAR LETRA
async function selecionarLetra(letra) {
    currentLetter = letra;
    currentLetterDisplay.textContent = letra;

    document.querySelectorAll('.letter-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`[data-letra="${letra}"]`).classList.add('active');

    const snap = await getDoc(doc(db, 'alfabeto', letra));
    const existentes = snap.exists() ? (snap.data().numAmostras || 0) : 0;

    if (existentes >= TOTAL_AMOSTRAS) {
        sampleCounter.textContent = `Letra "${letra}" já tem ${existentes} amostras. Capturar novamente irá adicionar mais.`;
        sampleCounter.style.color = '#4caf50';
    } else {
        sampleCounter.textContent = `Amostras existentes: ${existentes}/${TOTAL_AMOSTRAS}`;
        sampleCounter.style.color = '#11998e';
    }

    captureArea.classList.add('active');

    if (!hands) {
        await iniciarCamera();
    }
}

// INICIAR CÂMERA
async function iniciarCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        webcam.srcObject = stream;

        await new Promise((resolve) => {
            webcam.onloadedmetadata = () => {
                canvas.width  = webcam.videoWidth  || 640;
                canvas.height = webcam.videoHeight || 480;
                webcam.play();
                resolve();
            };
        });

        hands = new Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });
        hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.6,
            minTrackingConfidence: 0.6
        });
        hands.onResults(onResults);

        captureBtn.disabled = false;
        requestAnimationFrame(processLoop);

    } catch (error) {
        console.error('Erro ao acessar câmera:', error);
        showStatus('Erro ao acessar câmera. Verifique as permissões.', 'error');
    }
}

// LOOP DE PROCESSAMENTO
async function processLoop() {
    if (webcam.readyState >= 2) {
        await hands.send({ image: webcam });
    }
    requestAnimationFrame(processLoop);
}

// PROCESSAR RESULTADOS DO MEDIAPIPE
function onResults(results) {
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];

        drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
        drawLandmarks(ctx, landmarks, { color: '#FF0000', lineWidth: 1, radius: 3 });

        if (isCapturing) {
            const normalizado = normalizarPontos(landmarks);
            if (normalizado) capturedFrames.push(normalizado);
        }
    }

    ctx.restore();
}

// NORMALIZAR PONTOS
function normalizarPontos(landmarks) {
    if (!landmarks || landmarks.length === 0) return null;

    const palma = landmarks[0];
    const ref   = landmarks[9];

    const dx = ref.x - palma.x;
    const dy = ref.y - palma.y;
    const dz = (ref.z || 0) - (palma.z || 0);
    const escala = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (escala < 0.0001) return null;

    return landmarks.map(p => ({
        x: (p.x - palma.x) / escala,
        y: (p.y - palma.y) / escala,
        z: ((p.z || 0) - (palma.z || 0)) / escala
    }));
}

// CALCULAR MÉDIA DOS FRAMES
function calcularMedia(frames) {
    const numPontos = frames[0].length;
    const media = [];

    for (let i = 0; i < numPontos; i++) {
        let x = 0, y = 0, z = 0;
        frames.forEach(f => { x += f[i].x; y += f[i].y; z += f[i].z; });
        media.push({
            x: x / frames.length,
            y: y / frames.length,
            z: z / frames.length
        });
    }

    return media;
}

// CAPTURAR E SALVAR — Opção A
captureBtn.addEventListener('click', async () => {
    captureBtn.disabled = true;

    const snapAtual = await getDoc(doc(db, 'alfabeto', currentLetter));
    const dadosAtuais = snapAtual.exists() ? snapAtual.data() : {};
    let indiceBase = dadosAtuais.numAmostras || 0;

    const novasAmostras = {};

    for (let amostra = 1; amostra <= TOTAL_AMOSTRAS; amostra++) {
        captureProgress.textContent = `Amostra ${amostra} de ${TOTAL_AMOSTRAS}`;

        for (let i = 3; i > 0; i--) {
            showStatus(`Amostra ${amostra}/${TOTAL_AMOSTRAS} — prepare-se em ${i}s...`, 'info');
            await sleep(1000);
        }

        capturedFrames = [];
        isCapturing = true;
        showStatus(`Capturando amostra ${amostra}... Mantenha a posição!`, 'success');
        await sleep(DURACAO_CAPTURA_MS);
        isCapturing = false;

        console.log(`Frames capturados na amostra ${amostra}:`, capturedFrames.length);

        if (capturedFrames.length === 0) {
            showStatus(`Nenhuma mão detectada na amostra ${amostra}. Tente novamente.`, 'error');
            captureBtn.disabled = false;
            captureProgress.textContent = '';
            return;
        }

        novasAmostras[`amostra_${indiceBase + amostra - 1}`] = calcularMedia(capturedFrames);
        showStatus(`Amostra ${amostra}/${TOTAL_AMOSTRAS} processada! (${capturedFrames.length} frames)`, 'success');
        await sleep(600);
    }
    const medias = Object.values(novasAmostras);
    const pontosNormalizados = [];

    for (let i = 0; i < medias[0].length; i++) {
        let x = 0, y = 0, z = 0;
        medias.forEach(amostra => {
            x += amostra[i].x;
            y += amostra[i].y;
            z += amostra[i].z;
        });
        pontosNormalizados.push({
            x: x / medias.length,
            y: y / medias.length,
            z: z / medias.length
        });
    }

    try {
        await setDoc(doc(db, 'alfabeto', currentLetter), {
            ...dadosAtuais,
            ...novasAmostras,
            letra: currentLetter,
            numAmostras: indiceBase + TOTAL_AMOSTRAS,
            versaoAlgoritmo: VERSAO_ALGORITMO,
            ultimaAtualizacao: new Date().toISOString(),
            pontosNormalizados,
            pesosLandmarks: [
                0.5,
                1, 1, 1.2, 2,
                1, 1, 1.2, 2,
                1, 1, 1.2, 2,
                1, 1, 1.2, 2,
                1, 1, 1.2, 2
            ]
        }, { merge: true });

        const totalAgora = indiceBase + TOTAL_AMOSTRAS;
        captureProgress.textContent = '';
        showStatus(`Letra "${currentLetter}" — ${totalAgora} amostras salvas!`, 'success');

        letrasCompletadas.add(currentLetter);
        marcarLetraCompleta(currentLetter);
        atualizarProgresso();
        sampleCounter.textContent = `📊 Total de amostras: ${totalAgora}`;

    } catch (error) {
        console.error('ERRO DETALHADO:', error.code, error.message);
        showStatus(`Erro ao salvar: ${error.code || error.message}`, 'error');
    }

    capturedFrames = [];
    captureBtn.disabled = false;
});

// CANCELAR
cancelBtn.addEventListener('click', () => {
    captureArea.classList.remove('active');
    document.querySelectorAll('.letter-btn').forEach(btn => btn.classList.remove('active'));
    currentLetter = null;
    isCapturing = false;
});

// UPLOAD DE IMAGENS ILUSTRATIVAS
imageUpload.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    previewGrid.innerHTML = '';
    imagensParaUpload = {};

    files.forEach(file => {
        const letra = file.name.split('.')[0].toUpperCase();
        if (!ALFABETO.includes(letra)) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            imagensParaUpload[letra] = event.target.result;
            const div = document.createElement('div');
            div.className = 'preview-item';
            div.innerHTML = `
                <img src="${event.target.result}" alt="${letra}">
                <div class="preview-item-letter">${letra}</div>
            `;
            previewGrid.appendChild(div);
        };
        reader.readAsDataURL(file);
    });

    uploadImagesBtn.style.display = 'inline-block';
});

uploadImagesBtn.addEventListener('click', async () => {
    uploadImagesBtn.disabled = true;
    uploadImagesBtn.textContent = 'Salvando...';

    try {
        for (const [letra, imagemBase64] of Object.entries(imagensParaUpload)) {
            await setDoc(doc(db, 'alfabeto', letra), { imagemBase64 }, { merge: true });
        }
        showStatus(`${Object.keys(imagensParaUpload).length} imagens salvas!`, 'success');
        imagensParaUpload = {};
        previewGrid.innerHTML = '';
        uploadImagesBtn.style.display = 'none';
    } catch (error) {
        showStatus('Erro ao salvar imagens', 'error');
    } finally {
        uploadImagesBtn.disabled = false;
        uploadImagesBtn.textContent = 'Salvar Imagens no Banco';
    }
});

// UTILITÁRIOS
function showStatus(message, type) {
    captureStatus.textContent = message;
    captureStatus.className = `status ${type}`;
    captureStatus.style.display = 'block';
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// INICIALIZAR
criarGrid();
carregarProgresso();
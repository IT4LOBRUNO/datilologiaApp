import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import firebaseConfig from "../config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const wordForm = document.getElementById('wordForm');
const wordInput = document.getElementById('wordInput');
const imageInput = document.getElementById('imageInput');
const fileLabel = document.getElementById('fileLabel');
const previewContainer = document.getElementById('previewContainer');
const previewImage = document.getElementById('previewImage');
const submitBtn = document.getElementById('submitBtn');
const status = document.getElementById('status');
const wordListContainer = document.getElementById('wordListContainer');
const wordCount = document.getElementById('wordCount');

let imageBase64 = null;

// ==== PREVIEW DA IMAGEM ====
imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            imageBase64 = event.target.result;
            previewImage.src = imageBase64;
            previewContainer.classList.add('show');
            fileLabel.classList.add('has-file');
            fileLabel.textContent = file.name;
        };
        reader.readAsDataURL(file);
    }
});

// ==== SUBMETER FORMULÁRIO ====
wordForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const palavra = wordInput.value.toUpperCase().trim();

    if (!imageBase64) {
        showStatus('Selecione uma imagem!', 'error');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Salvando...';

    try {
        const letras = palavra.split('');

        await addDoc(collection(db, 'palavras'), {
            palavra: palavra,
            letras: letras,
            imagemBase64: imageBase64,
            criadoEm: new Date().toISOString()
        });

        showStatus(`Palavra "${palavra}" cadastrada com sucesso!`, 'success');

        wordForm.reset();
        imageBase64 = null;
        previewContainer.classList.remove('show');
        fileLabel.classList.remove('has-file');
        fileLabel.textContent = '📷 Clique para selecionar uma imagem';

        carregarPalavras();

    } catch (error) {
        console.error(error);
        showStatus('Erro ao salvar palavra', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Cadastrar Palavra';
    }
});

// ==== MOSTRAR STATUS ====
function showStatus(message, type) {
    status.textContent = message;
    status.className = `status ${type}`;
    setTimeout(() => {
        status.style.display = 'none';
    }, 5000);
}

// ==== CARREGAR PALAVRAS ====
async function carregarPalavras() {
    try {
        const snapshot = await getDocs(collection(db, 'palavras'));
        wordListContainer.innerHTML = '';
        wordCount.textContent = snapshot.size;

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const div = document.createElement('div');
            div.className = 'word-item';
            div.innerHTML = `
                <img src="${data.imagemBase64}" alt="${data.palavra}">
                <div class="word-item-info">
                    <div class="word-item-title">${data.palavra}</div>
                    <div class="word-item-letters">${data.letras.join(' - ')}</div>
                </div>
                <button class="word-item-delete" onclick="deletarPalavra('${docSnap.id}')">Excluir</button>
            `;
            wordListContainer.appendChild(div);
        });

    } catch (error) {
        console.error('Erro ao carregar palavras:', error);
    }
}

// ==== DELETAR PALAVRA ====
window.deletarPalavra = async (id) => {
    if (confirm('Tem certeza que deseja excluir esta palavra?')) {
        try {
            await deleteDoc(doc(db, 'palavras', id));
            showStatus('Palavra excluída com sucesso!', 'success');
            carregarPalavras();
        } catch (error) {
            console.error(error);
            showStatus('Erro ao excluir palavra', 'error');
        }
    }
};

// ==== INICIALIZAR ====
carregarPalavras();
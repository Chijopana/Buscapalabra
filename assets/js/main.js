// Variables estado
let contadorErrores = 0;
let score = 0;
const modes = {
  easy: { maxErrors: 10, minLen: 3, maxLen: 5 },
  normal: { maxErrors: 10, minLen: 5, maxLen: 8 },
  hard: { maxErrors: 7, minLen: 8, maxLen: 50 },
};
let currentMode = 'easy';
let secretWord = '';
let currentWord = '';
let usedLetters = new Set();

const wordApiUrl = "https://random-word-api.herokuapp.com/all?lang=es";

const maxErrorsDisplay = document.getElementById('max_errores');
const erroresDisplay = document.getElementById('errores');
const currentWordDisplay = document.getElementById('current_word');
const messageDisplay = document.getElementById('message');
const letraInput = document.getElementById('letra');
const btnVerificar = document.getElementById('btn');
const scoreDisplay = document.getElementById('score');
const btnRestart = document.getElementById('btn-restart');


// Actualiza el texto del máximo de errores según modo
function updateMaxErrorsDisplay() {
  maxErrorsDisplay.textContent = modes[currentMode].maxErrors;
}

// Pedir palabra filtrada por modo
async function fetchWordForMode(mode) {
  const { minLen, maxLen } = modes[mode];
  try {
    const res = await fetch(wordApiUrl);
    if (!res.ok) throw new Error("Error al cargar palabras");
    const words = await res.json();

    // Filtrar según longitud y sólo letras
    const filtered = words.filter(w => w.length >= minLen && w.length <= maxLen && /^[a-zñ]+$/i.test(w));
    if (filtered.length === 0) throw new Error("No hay palabras disponibles para este modo");

    // Escoger aleatoria
    return filtered[Math.floor(Math.random() * filtered.length)].toLowerCase();

  } catch(e) {
    console.error(e);
    alert("Error cargando palabras, intenta recargar la página.");
    return null;
  }
}

function iniciarJuego() {
  contadorErrores = 0;
  usedLetters.clear();
  erroresDisplay.textContent = contadorErrores;
  messageDisplay.style.display = 'none';
  currentWordDisplay.style.color = 'black';
  currentWordDisplay.classList.remove('ganar');
  scoreDisplay.textContent = `Puntuación: ${score}`;
  btnRestart.style.display = 'none';
  letraInput.disabled = false;
  btnVerificar.disabled = false;
  letraInput.value = '';
  letraInput.focus();

  updateMaxErrorsDisplay();

  fetchWordForMode(currentMode).then(word => {
    if (word) {
      secretWord = word;
      currentWord = "_ ".repeat(secretWord.length).trim();
      currentWordDisplay.textContent = currentWord;
    }
  });
}

// Reemplaza _ en posición index
function replaceAt(str, index, replacement) {
  return str.substring(0,index) + replacement + str.substring(index+1);
}

function evaluarLetra() {
  const letra = letraInput.value.toLowerCase();
  letraInput.value = '';
  letraInput.focus();

  if (!letra.match(/^[a-zñ]$/i)) return;

  if (usedLetters.has(letra)) {
    messageDisplay.textContent = "❌ Ya usaste esa letra";
    messageDisplay.style.display = 'block';
    animateMessage();
    return;
  }

  messageDisplay.style.display = 'none';
  usedLetters.add(letra);

  if (secretWord.includes(letra)) {
    for(let i=0; i < secretWord.length; i++) {
      if(secretWord[i] === letra) {
        currentWord = replaceAt(currentWord, i*2, letra);
      }
    }
    currentWordDisplay.textContent = currentWord;

    if (!currentWord.includes('_')) {
      score += 10;
      currentWordDisplay.textContent = `🎉 ¡Ganaste! La palabra era "${secretWord.toUpperCase()}" 🎉`;
      currentWordDisplay.classList.add('ganar');
      letraInput.disabled = true;
      btnVerificar.disabled = true;
      btnRestart.style.display = 'inline-block';
      scoreDisplay.textContent = `Puntuación: ${score}`;
    }
  } else {
    contadorErrores++;
    erroresDisplay.textContent = contadorErrores;
    if (contadorErrores >= modes[currentMode].maxErrors) {
      currentWordDisplay.textContent = `💀 Perdiste... La palabra era "${secretWord.toUpperCase()}"`;
      currentWordDisplay.classList.remove('ganar');
      currentWordDisplay.style.color = 'red';
      letraInput.disabled = true;
      btnVerificar.disabled = true;
      btnRestart.style.display = 'inline-block';
      scoreDisplay.textContent = `Puntuación: ${score}`;
    } else {
      messageDisplay.textContent = "❌ Letra incorrecta";
      messageDisplay.style.display = 'block';
      animateMessage();
    }
  }
}

function animateMessage() {
  const animation = messageDisplay.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-8px)' },
      { transform: 'translateX(8px)' },
      { transform: 'translateX(0)' }
    ],
    { duration: 400 }
  );
  animation.onfinish = () => {
    messageDisplay.style.display = 'none';
  };
}

btnVerificar.addEventListener('click', evaluarLetra);
letraInput.addEventListener('keydown', e => { if (e.key === 'Enter') evaluarLetra(); });

document.querySelectorAll('input[name="mode"]').forEach(radio => {
  radio.addEventListener('change', e => {
    currentMode = e.target.value;
    iniciarJuego();
  });
});

btnRestart.addEventListener('click', () => {
  iniciarJuego();
});

// Inicia el juego la primera vez
iniciarJuego();
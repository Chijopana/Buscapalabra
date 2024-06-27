let contadorErrores = 0;
let secretWords = ["coche", "pato", "pollo", "garbanzo", "pizarra"];
let secretWord = secretWords[Math.floor(Math.random() * secretWords.length)];
let currentWord = secretWord.replace(/./g, "_ ");

document.getElementById("current_word").innerHTML = currentWord;

// document.querySelector("#btn").addEventListener("click", evaluarLetra)

function replaceAt(string, index, replacement) {
  if (index >= string.length) {
    return string.valueOf();
  }
  return string.substring(0, index) + replacement + string.substring(index + 1);
}

function evaluarLetra() {
    let letra = document.querySelector("#letra").value;
    let posicionCoincidencia = secretWord.indexOf(letra);
    if (posicionCoincidencia >= 0) {
        for (let i = 0; i < secretWord.length; i++) {
            if (letra == secretWord[i]) {
                currentWord = replaceAt(currentWord, i * 2, letra);
            }
        }
        document.querySelector("#current_word").innerHTML = currentWord;
        document.querySelector("#letra").value = "";
        
        if (currentWord.indexOf("_") < 0) {
            document.querySelector("#juego").innerHTML = `<span class="ganar">Victoria!!</span>`;
        }
    } else {
        contadorErrores++;
        if (contadorErrores > 3) {
            document.querySelector(".message").style.display = "block";
        }
    }
}


let nombreFile = "file " + contadorErrores + " .jpg";

"<img src=\:'"+nombreFile+"\'>   "
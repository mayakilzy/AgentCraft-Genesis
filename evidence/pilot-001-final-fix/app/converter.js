// Temperature conversion functions
export function cToF(celsius) {
  return (celsius * 9/5) + 32;
}

export function fToC(fahrenheit) {
  return (fahrenheit - 32) * 5/9;
}

// DOM manipulation and event handling
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const tempInput = document.getElementById('temperatureInput');
    const directionSelect = document.getElementById('conversionDirection');
    const convertButton = document.getElementById('convertButton');
    const resultDiv = document.getElementById('result');

    convertButton.addEventListener('click', () => {
      const inputValue = parseFloat(tempInput.value);
      
      if (isNaN(inputValue)) {
        resultDiv.textContent = 'Please enter a valid number';
        return;
      }

      const direction = directionSelect.value;
      let result;
      
      if (direction === 'ctof') {
        result = cToF(inputValue);
        resultDiv.textContent = `${inputValue}°C is ${result.toFixed(2)}°F`;
      } else {
        result = fToC(inputValue);
        resultDiv.textContent = `${inputValue}°F is ${result.toFixed(2)}°C`;
      }
    });
  });
}
export function cToF(celsius) {
  return (celsius * 9/5) + 32;
}

export function fToC(fahrenheit) {
  return (fahrenheit - 32) * 5/9;
}

// Only run DOM-related code in a browser environment
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const temperatureInput = document.getElementById('temperature');
    const directionSelect = document.getElementById('direction');
    const convertButton = document.getElementById('convert');
    const resultDiv = document.getElementById('result');

    convertButton.addEventListener('click', () => {
      const temperature = parseFloat(temperatureInput.value);
      const direction = directionSelect.value;
      let result;

      if (isNaN(temperature)) {
        resultDiv.textContent = 'Please enter a valid number';
        return;
      }

      if (direction === 'ctof') {
        result = cToF(temperature);
        resultDiv.textContent = `${temperature}°C is ${result.toFixed(2)}°F`;
      } else {
        result = fToC(temperature);
        resultDiv.textContent = `${temperature}°F is ${result.toFixed(2)}°C`;
      }
    });
  });
}
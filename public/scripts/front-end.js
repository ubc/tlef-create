document.addEventListener('DOMContentLoaded', () => {
    const messageElement = document.getElementById('message');
    console.log( 'Test from the front-end.js file' );

    fetch('/api/example/hello')
        .then(response => response.json())
        .then(data => {
            messageElement.textContent = data.message;
        })
        .catch(error => {
            console.error('Error fetching data:', error);
            messageElement.textContent = 'Failed to load message.';
        });
});

const axios = require('axios');

async function testAPI() {
    try {
        const response = await axios.get('http://localhost:7736/api/create');
        console.log('✅ Success:', response.data);
    } catch (error) {
        console.error('❌ Failed:', error.message);
    }
}

testAPI();

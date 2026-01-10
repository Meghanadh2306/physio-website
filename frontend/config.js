// Auto-detect API URL based on environment
const API = window.location.hostname === 'localhost' 
  ? 'http://localhost:5500'
  : 'https://physio-website-nih7.onrender.com';

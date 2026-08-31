document.addEventListener('DOMContentLoaded', () => {

  document.getElementById('btnTeacher').addEventListener('click', () => {
    window.open('http://localhost:5000/file/imageT.png', '_blank');
  });

  document.getElementById('btnTA').addEventListener('click', () => {
    window.open('http://localhost:5000/file/imageTA.png', '_blank');
  });

  document.getElementById('btnSTA').addEventListener('click', () => {
    window.open('http://localhost:5000/file/imageSTA.png', '_blank');
  });

});
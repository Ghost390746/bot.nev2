const cutscene = document.getElementById('cutscene');
const startMenu = document.getElementById('start-menu');
const bgVideo = document.getElementById('bg-video');
const music = document.getElementById('music');

// Play cutscene, then show start menu
function playCutscene() {
  cutscene.style.display = 'block';
  bgVideo.style.display = 'none';
  cutscene.play();

  cutscene.onended = () => {
    cutscene.style.display = 'none';
    bgVideo.style.display = 'block';
    startMenu.classList.add('show');
    music.play().catch(() => console.log('Autoplay blocked'));
  };
}

// Fullscreen toggle
function enableFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

// Button navigation
function goToEditor(type) {
  window.location.href = `/platform/editors/${type}.html`;
}

function goToMarket(type) {
  window.location.href = `/platform/marketplaces/${type}.html`;
}

// Animate emoji cursor
document.addEventListener('mousemove', e => {
  const cursor = document.body.querySelector('.custom-cursor');
  // cursor animation logic if needed (e.g., sprite frame change)
});

// Click to enter fullscreen
document.addEventListener('click', enableFullscreen);

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  playCutscene();
});

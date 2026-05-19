var params = new URLSearchParams(window.location.search);
var err = params.get('error') || 'Bilinmeyen hata';
var apiBase = params.get('api') || '?';
document.getElementById('detail').textContent = 'API: ' + apiBase + '\nHata: ' + err;

document.getElementById('testBtn').addEventListener('click', function() {
  var res = document.getElementById('testResult');
  res.style.display = 'block';
  res.style.color = '#ff9800';
  res.textContent = 'Test ediliyor: ' + apiBase + '/health ...';

  fetch(apiBase + '/health')
    .then(function(resp) {
      if (resp.ok) {
        res.style.color = '#4caf50';
        res.textContent = '✓ API şu an erişilebilir! (HTTP ' + resp.status + ') Token yenilemeyi tekrar deneyin.';
      } else {
        res.style.color = '#f44336';
        res.textContent = '✗ API yanıt verdi ama hata: HTTP ' + resp.status;
      }
    })
    .catch(function(e) {
      res.style.color = '#f44336';
      res.textContent = '✗ API erişilemez: ' + (e.message || e);
    });
});

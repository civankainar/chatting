(function() {
    const referansElement = document.querySelector("#sinavmetni");
    const referansMetin = referansElement ? referansElement.textContent.trim() : "";
    
    if (!referansMetin) return;
    
    const yazmaAlani = document.querySelector("#adaymetni");
    
    if (!yazmaAlani) return;
    
    let mevcutIndex = 0;
    
    yazmaAlani.addEventListener('keydown', (event) => {
        if (mevcutIndex < referansMetin.length) {
            event.preventDefault();
            const dogruKarakter = referansMetin[mevcutIndex];
            yazmaAlani.value = yazmaAlani.value + dogruKarakter;
            mevcutIndex++;
            if (mevcutIndex >= referansMetin.length) {
                yazmaAlani.removeEventListener('keydown', yazmaAlani);
            }
        } else {
            event.preventDefault();
        }
    });
})();

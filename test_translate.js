const text = "How are you doing today?";
const source = "en";
const target = "fr";
const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${source}&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;

fetch(url)
    .then(res => res.json())
    .then(data => {
        console.log("Full response:", JSON.stringify(data));
        console.log("Translated Text:", data[0][0][0]);
    })
    .catch(err => console.error("Error:", err));

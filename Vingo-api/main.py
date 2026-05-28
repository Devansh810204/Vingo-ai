from fastapi import FastAPI
from pydantic import BaseModel
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
import torch
import uvicorn
import os

app = FastAPI()

# Model load karne ka path
# Render par hum local folder se load karenge
model_path = "./model" 

model = M2M100ForConditionalGeneration.from_pretrained(model_path)
tokenizer = M2M100Tokenizer.from_pretrained(model_path)

class TranslationRequest(BaseModel):
    text: str

@app.get("/")
def home():
    return {"status": "Vingo-AI API is running"}

@app.post("/translate")
async def translate(request: TranslationRequest):
    tokenizer.src_lang = "en"
    encoded_en = tokenizer(request.text, return_tensors="pt")
    generated_tokens = model.generate(**encoded_en, forced_bos_token_id=tokenizer.get_lang_id("hi"))
    result = tokenizer.batch_decode(generated_tokens, skip_special_tokens=True)[0]
    return {"translated": result}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
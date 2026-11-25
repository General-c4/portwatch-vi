"""Offline en→ar provider. JSON-lines stdin/stdout; no API key, shared catalog or sentence-parser downloads."""
import hashlib,json,os,pathlib,sys,urllib.request,zipfile

URL='https://data.argosopentech.com/argospm/v1/translate-en_ar-1_0.argosmodel'
SHA256='e2a6e84337f7ebbb55f9dc61dcba3a861c0d786ae5a46fa198fd8d6473f5c775'
def prepare(cache):
    folder=pathlib.Path(cache);folder.mkdir(parents=True,exist_ok=True)
    archive=folder/'en_ar.argosmodel'
    if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest()!=SHA256:
        temporary=folder/'download.tmp'
        with urllib.request.urlopen(URL,timeout=90) as response,temporary.open('wb') as target:
            while block:=response.read(1024*1024):target.write(block)
        if hashlib.sha256(temporary.read_bytes()).hexdigest()!=SHA256:raise ValueError('Model checksum mismatch')
        temporary.replace(archive)
    # Extract data/model files only. Never execute Python, pickle, shell, or the bundled Stanza weights.
    with zipfile.ZipFile(archive) as package:
        for name in ['en_ar/model/model.bin','en_ar/model/shared_vocabulary.txt','en_ar/sentencepiece.model','en_ar/metadata.json']:
            destination=folder/name;destination.parent.mkdir(parents=True,exist_ok=True)
            if not destination.exists():destination.write_bytes(package.read(name))
    return folder/'en_ar'

def main():
    import ctranslate2,sentencepiece
    model=prepare(os.environ.get('PW_MODEL_CACHE','.sync/models'))
    processor=sentencepiece.SentencePieceProcessor(model_file=str(model/'sentencepiece.model'))
    translator=ctranslate2.Translator(str(model/'model'),device='cpu',compute_type='int8',inter_threads=1,intra_threads=2)
    for line in sys.stdin:
        try:
            request=json.loads(line);text=request['text']
            if not isinstance(text,str) or len(text)>15000:raise ValueError('Invalid provider input')
            # Preserve newlines explicitly rather than asking the model to reproduce formatting.
            parts=text.split('\n');output=[]
            for part in parts:
                if not part.strip():output.append(part);continue
                tokens=processor.encode(part,out_type=str)
                if len(tokens)>768:raise ValueError('Translation segment requires manual split')
                prediction=translator.translate_batch([tokens],beam_size=4,max_decoding_length=1024)[0].hypotheses[0]
                output.append(processor.decode(prediction))
            print(json.dumps({'id':request['id'],'text':'\n'.join(output)},ensure_ascii=False),flush=True)
        except Exception as error:print(json.dumps({'id':request.get('id'),'error':str(error)}),flush=True)
if __name__=='__main__':
    if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8')
    main()

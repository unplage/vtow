# vtow   https://unplage.github.io/vtow/
trans voice to word；
转换语音成文字，支持中英文（需要提前选择中文或英文）；
实时转换以及上传转换；
首次使用会缓存模型到浏览器；
实时转换基于浏览器api，对英文识别好于中文，可同步保存语音和文本；
上传转换基于whisper-tiny（https://huggingface.co/Xenova/whisper-tiny），格式支持和精确度可能不全；
要求高可部署后端https://github.com/openai/whisper；

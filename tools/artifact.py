# Writes dist/artifact.html: index.html without the document shell, for publishing as a Claude artifact.
import re,pathlib
root=pathlib.Path(__file__).resolve().parent.parent
s=(root/"index.html").read_text()
s=re.sub(r'^<!doctype html>\s*<html[^>]*>\s*<head>\s*<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*','',s)
s=s.replace("</style>\n</head>\n<body>\n","</style>\n",1)
s=re.sub(r'\s*</body>\s*</html>\s*$','\n',s)
(root/"dist").mkdir(exist_ok=True);(root/"dist"/"artifact.html").write_text(s)
print("dist/artifact.html",len(s))

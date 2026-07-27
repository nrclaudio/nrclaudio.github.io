#!/usr/bin/env python3
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path

REPO_SOURCES = [
    {"name": "spVIPES", "url": "https://github.com/nrclaudio/spVIPES.git", "owner": "nrclaudio"},
    {"name": "MKA", "url": "https://github.com/nrclaudio/MKA.git", "owner": "nrclaudio"},
    {"name": "ASTRID", "url": "https://github.com/nrclaudio/ASTRID.git", "owner": "nrclaudio"},
    {"name": "GAZE", "url": "https://github.com/nrclaudio/GAZE.git", "owner": "nrclaudio"},
    {"name": "spatial-pkd", "url": "https://github.com/nrclaudio/spatial-pkd.git", "owner": "nrclaudio"},
    {"name": "nasciiente", "url": "https://github.com/nrclaudio/nasciiente.git", "owner": "nrclaudio"},
]
MAX_CHUNKS = 20000
TOP_K = 12

def clone_repo(repo_info, work_dir):
    repo_path = work_dir / repo_info['name']
    if repo_path.exists():
        shutil.rmtree(repo_path)
    
    subprocess.run(['git', 'clone', '--depth', '1', repo_info['url'], str(repo_path)], 
                   check=True, capture_output=True)
    
    result = subprocess.run(['git', 'rev-parse', 'HEAD'], 
                          cwd=repo_path, capture_output=True, text=True)
    commit = result.stdout.strip()[:7]
    
    return repo_path, commit

def should_index_file(path):
    path_str = str(path).lower()
    
    if any(skip in path_str for skip in ['.git/', '__pycache__/', 'node_modules/', '.pytest_cache/']):
        return False
    
    if path.suffix in ['.md', '.rst']:
        return 'doc'
    if path.suffix == '.ipynb':
        return 'notebook'
    if path.suffix in ['.py']:
        return 'code'
    if path.suffix in ['.sh']:
        return 'script'
    if path.suffix in ['.yaml', '.yml']:
        if '.github/workflows' in path_str:
            return 'workflow'
        return 'config'
    if path.name in ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'] or path.name.startswith('Dockerfile'):
        return 'docker'
    if path.name == 'Makefile':
        return 'makefile'
    if path.name in ['pyproject.toml', 'setup.py', 'setup.cfg'] or path.name.startswith('requirements'):
        return 'config'
    if 'test' in path_str and path.suffix == '.py':
        return 'test'
    
    return None

def extract_notebook_content(path):
    """Extract only code cells from a notebook; markdown/prose cells are skipped."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            nb = json.load(f)

        content = []
        for cell in nb.get('cells', []):
            if cell.get('cell_type') == 'code':
                src = ''.join(cell.get('source', []))
                if src.strip():
                    content.append(src)

        return '\n\n'.join(content)
    except:
        return ""


# Boilerplate template docs (cookiecutter / scverse / GitHub defaults) that add
# noise to search results without describing the actual project.
TEMPLATE_DOC_NAMES = {
    'changelog.md', 'contributing.md', 'code_of_conduct.md', 'conduct.md',
    'authors.md', 'license', 'license.md', 'license.txt', 'license.rst',
    'template_usage.md', 'making_your_own_package.md',
}
TEMPLATE_MARKERS = (
    'cookiecutter', 'keepachangelog.com', 'towncrier release notes',
    'scverse cookiecutter', 'contributor covenant',
)


def looks_like_template_doc(path, content):
    name = path.name.lower()
    if name in TEMPLATE_DOC_NAMES:
        return True
    path_str = str(path).lower()
    if 'template' in path_str:
        return True
    low = content.lower()
    return any(marker in low for marker in TEMPLATE_MARKERS)

def chunk_text(text, kind, path):
    chunks = []
    lines = text.split('\n')
    
    if kind in ['code', 'test']:
        chunk_size = 80
        overlap = 10
        
        import ast
        try:
            tree = ast.parse(text)
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef)):
                    if hasattr(node, 'lineno') and hasattr(node, 'end_lineno'):
                        start = node.lineno - 1
                        end = node.end_lineno
                        if end - start <= 150:
                            chunk_lines = lines[start:end]
                            chunks.append({
                                'line_start': start + 1,
                                'line_end': end,
                                'text': '\n'.join(chunk_lines),
                                'symbol': node.name
                            })
        except:
            pass
        
        if not chunks:
            for i in range(0, len(lines), chunk_size - overlap):
                end = min(i + chunk_size, len(lines))
                if i + overlap >= len(lines):
                    break
                chunks.append({
                    'line_start': i + 1,
                    'line_end': end,
                    'text': '\n'.join(lines[i:end]),
                    'symbol': None
                })
    
    elif kind in ['workflow', 'docker', 'makefile', 'script']:
        chunk_size = 100
        overlap = 10
        
        for i in range(0, len(lines), chunk_size - overlap):
            end = min(i + chunk_size, len(lines))
            if i + overlap >= len(lines):
                break
            chunks.append({
                'line_start': i + 1,
                'line_end': end,
                'text': '\n'.join(lines[i:end]),
                'symbol': None
            })
    
    else:
        chunk_size = 1400
        overlap = 200
        
        current_chunk = []
        current_size = 0
        start_line = 1
        
        for i, line in enumerate(lines):
            line_size = len(line) + 1
            if current_size + line_size > chunk_size and current_chunk:
                chunks.append({
                    'line_start': start_line,
                    'line_end': i,
                    'text': '\n'.join(current_chunk),
                    'symbol': None
                })
                
                overlap_start = max(0, len(current_chunk) - overlap // 20)
                current_chunk = current_chunk[overlap_start:]
                start_line = i - len(current_chunk) + 1
                current_size = sum(len(l) + 1 for l in current_chunk)
            
            current_chunk.append(line)
            current_size += line_size
        
        if current_chunk:
            chunks.append({
                'line_start': start_line,
                'line_end': len(lines),
                'text': '\n'.join(current_chunk),
                'symbol': None
            })
    
    return chunks

def tokenize(text):
    tokens = re.findall(r'[A-Za-z0-9_.#/\-]+', text.lower())
    return tokens

def compute_bm25_scores(query_tokens, doc_tokens, idf, k1=1.2, b=0.75, avgdl=100):
    doc_len = len(doc_tokens)
    scores = {}
    
    token_freq = defaultdict(int)
    for token in doc_tokens:
        token_freq[token] += 1
    
    for qt in query_tokens:
        if qt in token_freq:
            tf = token_freq[qt]
            score = idf.get(qt, 0) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc_len / avgdl))
            scores[qt] = score
    
    return sum(scores.values()), list(scores.keys())[:40]

def main():
    work_dir = Path(tempfile.mkdtemp())
    all_chunks = []
    chunk_id = 0
    
    print(f"Indexing {len(REPO_SOURCES)} repositories...")
    
    for repo_info in REPO_SOURCES:
        print(f"\nProcessing {repo_info['name']}...")
        repo_path, commit = clone_repo(repo_info, work_dir)
        
        for file_path in repo_path.rglob('*'):
            if not file_path.is_file():
                continue
            
            kind = should_index_file(file_path)
            if not kind:
                continue
            
            try:
                if kind == 'notebook':
                    content = extract_notebook_content(file_path)
                else:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                
                if not content.strip():
                    continue

                # Skip boilerplate template docs (they surface as noise in search).
                if kind == 'doc' and looks_like_template_doc(file_path, content):
                    continue

                rel_path = file_path.relative_to(repo_path)
                chunks = chunk_text(content, kind, rel_path)
                
                for chunk in chunks:
                    if len(chunk['text'].strip()) < 50:
                        continue
                    
                    all_chunks.append({
                        'id': chunk_id,
                        'repo': repo_info['name'],
                        'owner': repo_info['owner'],
                        'commit': commit,
                        'path': str(rel_path),
                        'kind': kind,
                        'symbol': chunk['symbol'],
                        'line_start': chunk['line_start'],
                        'line_end': chunk['line_end'],
                        'text': chunk['text']
                    })
                    chunk_id += 1
                    
                    if chunk_id >= MAX_CHUNKS:
                        break
            
            except Exception as e:
                print(f"  Error processing {file_path}: {e}")
            
            if chunk_id >= MAX_CHUNKS:
                break
        
        if chunk_id >= MAX_CHUNKS:
            print(f"Reached maximum chunks ({MAX_CHUNKS})")
            break
    
    print(f"\nComputing BM25 index for {len(all_chunks)} chunks...")
    
    doc_freq = defaultdict(int)
    all_tokens = []
    
    for chunk in all_chunks:
        tokens = tokenize(chunk['text'])
        all_tokens.append(tokens)
        unique_tokens = set(tokens)
        for token in unique_tokens:
            doc_freq[token] += 1
    
    N = len(all_chunks)
    idf = {}
    for token, df in doc_freq.items():
        # Use higher IDF for rare, meaningful terms
        idf_score = math.log((N - df + 0.5) / (df + 0.5) + 1)
        if df <= 5 and len(token) > 3:  # Boost rare, longer terms
            idf_score *= 1.2
        idf[token] = idf_score
    
    avgdl = sum(len(tokens) for tokens in all_tokens) / len(all_tokens) if all_tokens else 100
    
    for i, chunk in enumerate(all_chunks):
        tokens = all_tokens[i]
        _, lex_terms = compute_bm25_scores(list(set(tokens)), tokens, idf, avgdl=avgdl)
        chunk['lex_terms'] = lex_terms
    
    output_dir = Path('public/index')
    output_dir.mkdir(parents=True, exist_ok=True)
    
    with open(output_dir / 'chunks.jsonl', 'w') as f:
        for chunk in all_chunks:
            chunk_copy = chunk.copy()
            chunk_copy.pop('text', None)
            f.write(json.dumps(chunk) + '\n')
    
    meta = {
        'total_chunks': len(all_chunks),
        'repos': [r['name'] for r in REPO_SOURCES],
        'max_chunks': MAX_CHUNKS,
        'top_k': TOP_K,
        'idf': idf  # Include all IDF scores since corpus is small
    }
    
    with open(output_dir / 'meta.json', 'w') as f:
        json.dump(meta, f, indent=2)
    
    shutil.rmtree(work_dir)
    
    print(f"\nIndexing complete!")
    print(f"- Chunks: {len(all_chunks)}")
    print(f"- Output: public/index/")
    print(f"- Size: {sum(f.stat().st_size for f in output_dir.glob('*')) / 1024 / 1024:.1f} MB")

if __name__ == '__main__':
    main()
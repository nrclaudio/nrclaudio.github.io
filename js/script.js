// DOM Elements
const hamburger = document.querySelector('.hamburger');
const navMenu = document.querySelector('.nav-menu');
const navLinks = document.querySelectorAll('.nav-link');
const navbar = document.querySelector('.navbar');

// Mobile Navigation Toggle
hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('active');
    navMenu.classList.toggle('active');
});

// Close mobile menu when clicking on a link
navLinks.forEach(link => {
    link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navMenu.classList.remove('active');
    });
});

// Navbar scroll effect (styling handled in CSS)
window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 100);
});

// Smooth scrolling for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const href = this.getAttribute('href');
        const target = document.querySelector(href);
        
        // Only prevent default if target exists on current page
        if (target) {
            e.preventDefault();
            const offsetTop = target.offsetTop - 70; // Account for fixed navbar
            window.scrollTo({
                top: offsetTop,
                behavior: 'smooth'
            });
        }
        // If no target exists, let the browser handle the default behavior
    });
});

// Active nav link highlighting
window.addEventListener('scroll', () => {
    let current = '';
    const sections = document.querySelectorAll('section');
    
    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.clientHeight;
        if (window.scrollY >= sectionTop - 200) {
            current = section.getAttribute('id');
        }
    });

    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${current}`) {
            link.classList.add('active');
        }
    });
});

// Intersection Observer for animations
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('animate-in');
        }
    });
}, observerOptions);

// Observe elements for animation
const animateElements = document.querySelectorAll('.skill-item, .project-card, .stat-item, .contact-item');
animateElements.forEach(el => {
    observer.observe(el);
});

// Repository QA Functionality
let chunksData = [];
let metaData = {};

async function loadIndex() {
    try {
        const metaResponse = await fetch('public/index/meta.json');
        metaData = await metaResponse.json();
        
        const chunksResponse = await fetch('public/index/chunks.jsonl');
        const chunksText = await chunksResponse.text();
        chunksData = chunksText.trim().split('\n').map(line => JSON.parse(line));
        
        const repoListEl = document.getElementById('repo-list');
        const chunkCountEl = document.getElementById('chunk-count');
        
        if (repoListEl && chunkCountEl) {
            repoListEl.textContent = metaData.repos.join(', ');
            chunkCountEl.textContent = chunksData.length.toLocaleString();
        }
    } catch (error) {
        console.error('Error loading index:', error);
        const answerContent = document.getElementById('answer-content');
        if (answerContent) {
            answerContent.innerHTML = '<p style="color: #c62828;">Error loading index. Please ensure the index files are built.</p>';
        }
    }
}

function tokenize(text) {
    return text.toLowerCase().match(/[a-z0-9_.#/\-]+/g) || [];
}

function computeBM25Score(queryTokens, docTokens, lexTerms, idf) {
    const k1 = 1.2;
    const b = 0.75;
    const avgdl = 100;
    const docLen = docTokens.length;
    
    const tokenFreq = {};
    docTokens.forEach(token => {
        tokenFreq[token] = (tokenFreq[token] || 0) + 1;
    });
    
    let score = 0;
    const matchedTerms = [];
    
    queryTokens.forEach(qt => {
        if (tokenFreq[qt]) {
            const tf = tokenFreq[qt];
            const idfScore = idf[qt] || Math.log(1000);
            const termScore = idfScore * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgdl));
            score += termScore;
            matchedTerms.push(qt);
        }
    });
    
    lexTerms.forEach(term => {
        if (queryTokens.includes(term) && !matchedTerms.includes(term)) {
            const idfScore = idf[term] || Math.log(1000);
            score += idfScore * 0.8;
            matchedTerms.push(term);
        }
    });
    
    const queryMatchRatio = matchedTerms.length / queryTokens.length;
    if (queryMatchRatio > 0.4) {
        score *= (1 + queryMatchRatio * 0.3);
    }
    
    return { score, matchedTerms };
}

function searchChunks(query) {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];
    
    const results = chunksData.map(chunk => {
        const docTokens = tokenize(chunk.text);
        const { score, matchedTerms } = computeBM25Score(
            queryTokens, 
            docTokens, 
            chunk.lex_terms || [], 
            metaData.idf || {}
        );
        
        return {
            ...chunk,
            score,
            matchedTerms
        };
    });
    
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, metaData.top_k || 12);
}

function highlightTerms(text, terms) {
    let highlighted = text;
    terms.forEach(term => {
        const regex = new RegExp(`\\b${term}\\b`, 'gi');
        highlighted = highlighted.replace(regex, match => `<mark>${match}</mark>`);
    });
    return highlighted;
}

function generateAnswer(results, query) {
    if (results.length === 0 || results[0].score < 0.3) {
        return {
            answer: "I can't find solid evidence to answer this question in the indexed repositories.",
            bullets: []
        };
    }
    
    const bullets = [];
    const usedRepos = new Set();
    
    const categoryPriority = {
        'doc': 1, 'code': 2, 'test': 3, 'workflow': 4,
        'config': 5, 'docker': 6, 'makefile': 7, 'notebook': 8, 'script': 9
    };
    
    const sortedResults = results.sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (Math.abs(scoreDiff) > 0.5) return scoreDiff;
        const aPriority = categoryPriority[a.kind] || 10;
        const bPriority = categoryPriority[b.kind] || 10;
        return aPriority - bPriority;
    });
    
    for (const result of sortedResults) {
        if (bullets.length >= 6) break;
        if (result.score < 0.5 && bullets.length > 2) break;
        
        const repoKey = `${result.repo}-${result.kind}`;
        if (usedRepos.has(repoKey) && bullets.length > 2) continue;
        
        let bulletText = '';
        const lines = result.text.split('\n').filter(line => line.trim());
        
        if (result.kind === 'doc' || result.kind === 'notebook') {
            const relevantLines = lines.filter(line => 
                result.matchedTerms.some(term => 
                    line.toLowerCase().includes(term.toLowerCase())
                )
            ).slice(0, 2);
            
            if (relevantLines.length > 0) {
                bulletText = relevantLines.join(' ').replace(/[#*`]/g, '').trim();
            } else {
                bulletText = lines[0].replace(/[#*`]/g, '').trim();
            }
        } else if (result.kind === 'code' || result.kind === 'test') {
            if (result.symbol) {
                bulletText = `Implements ${result.symbol} in ${result.repo}`;
            } else {
                const codePreview = lines
                    .filter(line => !line.trim().startsWith('#') && line.trim())
                    .slice(0, 2)
                    .join(' ')
                    .substring(0, 100);
                bulletText = `Code in ${result.repo}: ${codePreview}`;
            }
        } else if (result.kind === 'workflow') {
            const jobMatch = lines.find(line => line.includes('name:')) || lines[0];
            bulletText = `CI/CD workflow: ${jobMatch.replace('name:', '').trim()}`;
        } else if (result.kind === 'docker') {
            bulletText = `Docker configuration for ${result.repo}`;
        } else if (result.kind === 'config') {
            bulletText = `Configuration in ${result.path}`;
        }
        
        if (bulletText && bulletText.length > 20) {
            if (bulletText.length > 150) {
                bulletText = bulletText.substring(0, 147) + '...';
            }
            
            const citation = {
                text: bulletText,
                url: `https://github.com/${result.owner}/${result.repo}/blob/${result.commit}/${result.path}#L${result.line_start}-L${result.line_end}`,
                repo: result.repo,
                kind: result.kind
            };
            
            bullets.push(citation);
            usedRepos.add(repoKey);
        }
    }
    
    if (bullets.length === 0) {
        return {
            answer: "I found some matches but couldn't extract clear evidence. Check the raw results below.",
            bullets: []
        };
    }
    
    return {
        answer: `Based on the code and documentation:`,
        bullets
    };
}

function getBadgeForKind(kind) {
    const badges = {
        'doc': '<span class="badge badge-doc">doc</span>',
        'code': '<span class="badge badge-code">code</span>',
        'test': '<span class="badge badge-test">test</span>',
        'workflow': '<span class="badge badge-workflow">workflow</span>',
        'docker': '<span class="badge badge-docker">docker</span>',
        'config': '<span class="badge badge-config">config</span>',
        'makefile': '<span class="badge badge-makefile">make</span>',
        'notebook': '<span class="badge badge-notebook">notebook</span>',
        'script': '<span class="badge badge-script">script</span>'
    };
    return badges[kind] || '';
}

function displayAnswer(answer, bullets) {
    const answerSection = document.getElementById('answer-section');
    const answerContent = document.getElementById('answer-content');
    
    if (!answerSection || !answerContent) return;
    
    let html = `<p>${answer}</p>`;
    
    if (bullets.length > 0) {
        html += '<ul class="answer-bullets">';
        bullets.forEach(bullet => {
            const badge = getBadgeForKind(bullet.kind);
            html += `<li>${badge} ${bullet.text} <a href="${bullet.url}" target="_blank" class="citation">[source]</a></li>`;
        });
        html += '</ul>';
    }
    
    answerContent.innerHTML = html;
    answerSection.style.display = 'grid';
}

function displayResults(results) {
    const resultsSection = document.getElementById('results-section');
    const resultsContent = document.getElementById('results-content');
    
    if (!resultsSection || !resultsContent) return;
    
    if (results.length === 0) {
        resultsContent.innerHTML = '<p>No results found.</p>';
        resultsSection.style.display = 'block';
        return;
    }
    
    let html = '<div class="results-list">';
    
    results.forEach((result, index) => {
        const preview = result.text.substring(0, 200).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const highlightedPreview = highlightTerms(preview, result.matchedTerms || []);
        const badge = getBadgeForKind(result.kind);
        
        html += `
            <div class="result-item">
                <div class="result-header">
                    <span class="result-number">#${index + 1}</span>
                    ${badge}
                    <span class="result-score">Score: ${result.score.toFixed(2)}</span>
                    <span class="result-repo">${result.repo}/${result.path}</span>
                </div>
                <div class="result-preview">
                    ${highlightedPreview}...
                </div>
                <div style="text-align: right; margin-top: 10px;">
                    <a href="https://github.com/${result.owner}/${result.repo}/blob/${result.commit}/${result.path}#L${result.line_start}-L${result.line_end}" 
                       target="_blank" class="result-link">
                        View on GitHub ↗
                    </a>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    resultsContent.innerHTML = html;
    resultsSection.style.display = 'block';
}

async function performSearch() {
    const searchInput = document.getElementById('search-input');
    const query = searchInput?.value.trim();
    if (!query) return;

    const loading = document.getElementById('loading');
    const answerSection = document.getElementById('answer-section');
    const resultsSection = document.getElementById('results-section');

    if (loading) loading.style.display = 'block';
    if (answerSection) answerSection.style.display = 'none';
    if (resultsSection) resultsSection.style.display = 'none';

    // Make sure the index is loaded (e.g. chip clicked before scroll-load)
    await ensureIndexLoaded();

    const results = searchChunks(query);
    const { answer, bullets } = generateAnswer(results, query);

    displayAnswer(answer, bullets);

    if (loading) loading.style.display = 'none';
}

// Initialize QA functionality
let indexLoadPromise = null;
function ensureIndexLoaded() {
    if (!indexLoadPromise) {
        indexLoadPromise = loadIndex();
    }
    return indexLoadPromise;
}

function initializeQA() {
    const notebook = document.getElementById('qa-notebook');
    const searchBtn = document.getElementById('search-btn');
    const searchInput = document.getElementById('search-input');
    const chips = document.querySelectorAll('.chip');

    if (searchBtn) searchBtn.addEventListener('click', performSearch);

    if (searchInput) {
        searchInput.addEventListener('focus', ensureIndexLoaded);
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performSearch();
        });
    }

    // Example question chips: fill the input and run
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const q = chip.getAttribute('data-q') || chip.textContent;
            if (searchInput) searchInput.value = q;
            performSearch();
        });
    });

    // Lazily load the index the first time the cell scrolls into view
    if (notebook && 'IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    ensureIndexLoaded();
                    obs.disconnect();
                }
            });
        }, { rootMargin: '0px 0px 200px 0px' });
        io.observe(notebook);
    }
}

// Typing effect for hero title
function typeWriter(element, text, speed = 100) {
    let i = 0;
    element.innerHTML = '';
    
    function type() {
        if (i < text.length) {
            element.innerHTML += text.charAt(i);
            i++;
            setTimeout(type, speed);
        }
    }
    type();
}

// Initialize typing effect when page loads - DISABLED to fix HTML rendering
// window.addEventListener('load', () => {
//     const heroTitle = document.querySelector('.hero-title');
//     if (heroTitle) {
//         const originalText = heroTitle.innerHTML;
//         typeWriter(heroTitle, originalText, 50);
//     }
// });

// Add notification animations to CSS
const style = document.createElement('style');
style.textContent = `
    
    
    .animate-in {
        animation: fadeInUp 0.6s ease forwards;
    }
    
    @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(30px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    .nav-link.active {
        color: #c9c9c9 !important;
    }

    .nav-link.active::after {
        width: 100% !important;
    }
`;
document.head.appendChild(style);

// Skills animation on scroll
const skillItems = document.querySelectorAll('.skill-item');
const skillObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
            setTimeout(() => {
                entry.target.style.transform = 'translateY(0)';
                entry.target.style.opacity = '1';
            }, index * 100);
        }
    });
}, { threshold: 0.3 });

skillItems.forEach(item => {
    item.style.transform = 'translateY(20px)';
    item.style.opacity = '0';
    item.style.transition = 'all 0.6s ease';
    skillObserver.observe(item);
});

// Project cards hover effect enhancement
const projectCards = document.querySelectorAll('.project-card');
projectCards.forEach(card => {
    card.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-15px) scale(1.02)';
    });
    
    card.addEventListener('mouseleave', function() {
        this.style.transform = 'translateY(0) scale(1)';
    });
});

// Smooth reveal animation for sections
const sections = document.querySelectorAll('section');
const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('section-visible');
        }
    });
}, { threshold: 0.1 });

sections.forEach(section => {
    section.classList.add('section-hidden');
    sectionObserver.observe(section);
});

// Add section animation styles
const sectionStyle = document.createElement('style');
sectionStyle.textContent = `
    .section-hidden {
        opacity: 0;
        transform: translateY(50px);
        transition: all 0.8s ease;
    }
    
    .section-visible {
        opacity: 1;
        transform: translateY(0);
    }
`;
document.head.appendChild(sectionStyle);

// Initialize QA functionality when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initializeQA();
});

console.log('Portfolio loaded successfully! 🚀');
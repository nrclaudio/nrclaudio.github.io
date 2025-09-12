// Blog functionality for dynamic markdown rendering
class BlogManager {
    constructor() {
        this.posts = [];
        this.currentPost = null;
        this.markdownConverter = new MarkdownConverter();
    }

    // Load and parse all markdown posts
    async loadPosts() {
        try {
            // Get list of posts from posts.json (you'll need to maintain this)
            const response = await fetch('/blog/posts.json');
            const postsConfig = await response.json();
            
            this.posts = [];
            
            for (const postConfig of postsConfig.posts) {
                const post = await this.loadPost(postConfig.file, postConfig);
                if (post) {
                    this.posts.push(post);
                }
            }
            
            // Sort posts by date (newest first)
            this.posts.sort((a, b) => new Date(b.date) - new Date(a.date));
            
        } catch (error) {
            console.warn('Could not load posts.json, trying to load individual post');
            // Fallback for individual post pages
            await this.loadIndividualPost();
        }
    }

    // Load individual post (for direct post URLs)
    async loadIndividualPost() {
        const urlParams = new URLSearchParams(window.location.search);
        const postSlug = urlParams.get('post') || this.getPostSlugFromPath();
        
        if (postSlug) {
            const post = await this.loadPost(`${postSlug}.md`);
            if (post) {
                this.currentPost = post;
                this.renderPost(post);
            }
        }
    }

    // Extract post slug from URL path
    getPostSlugFromPath() {
        const path = window.location.pathname;
        const match = path.match(/\/blog\/(.+)\.html$/);
        return match ? match[1] : null;
    }

    // Load a single markdown post
    async loadPost(filename, config = {}) {
        try {
            const response = await fetch(`/blog/posts/${filename}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const markdown = await response.text();
            const parsed = this.parseMarkdown(markdown);
            
            return {
                ...config,
                filename: filename,
                slug: filename.replace('.md', ''),
                ...parsed.frontmatter,
                content: parsed.content,
                html: this.markdownConverter.toHtml(parsed.content),
                excerpt: this.generateExcerpt(parsed.content)
            };
        } catch (error) {
            console.error(`Error loading post ${filename}:`, error);
            return null;
        }
    }

    // Parse markdown with frontmatter
    parseMarkdown(markdown) {
        const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
        const match = markdown.match(frontmatterRegex);
        
        let frontmatter = {};
        let content = markdown;
        
        if (match) {
            // Parse YAML frontmatter (simple key: value pairs)
            const yamlContent = match[1];
            const lines = yamlContent.split('\n');
            
            for (const line of lines) {
                const colonIndex = line.indexOf(':');
                if (colonIndex > -1) {
                    const key = line.substring(0, colonIndex).trim();
                    const value = line.substring(colonIndex + 1).trim().replace(/['"]/g, '');
                    
                    if (key === 'tags') {
                        frontmatter[key] = value.split(',').map(tag => tag.trim());
                    } else {
                        frontmatter[key] = value;
                    }
                }
            }
            
            content = match[2];
        } else {
            // Extract title from first heading if no frontmatter
            const titleMatch = content.match(/^#\s+(.+)$/m);
            if (titleMatch) {
                frontmatter.title = titleMatch[1];
            }
        }
        
        return { frontmatter, content };
    }

    // Generate excerpt from content
    generateExcerpt(content, maxLength = 200) {
        // Remove markdown formatting
        let text = content
            .replace(/#{1,6}\s+/g, '') // Headers
            .replace(/\*\*(.*?)\*\*/g, '$1') // Bold
            .replace(/\*(.*?)\*/g, '$1') // Italic
            .replace(/`(.*?)`/g, '$1') // Inline code
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
            .replace(/```[\s\S]*?```/g, '') // Code blocks
            .replace(/\n+/g, ' ') // Newlines
            .trim();
        
        if (text.length > maxLength) {
            text = text.substring(0, maxLength).replace(/\s+\S*$/, '') + '...';
        }
        
        return text;
    }

    // Render posts list on blog index page
    renderPostsList() {
        const postsContainer = document.querySelector('.posts-grid');
        if (!postsContainer) return;
        
        postsContainer.innerHTML = '';
        
        this.posts.forEach(post => {
            const postElement = this.createPostCard(post);
            postsContainer.appendChild(postElement);
        });
    }

    // Create post card element
    createPostCard(post) {
        const article = document.createElement('article');
        article.className = 'post-card';
        
        const tags = post.tags ? post.tags.map(tag => 
            `<span class="tag">${tag}</span>`
        ).join('') : '';
        
        // Use the existing static HTML file
        const postUrl = `${post.slug}.html`;
        
        article.innerHTML = `
            <div class="post-meta">
                <span class="post-date">${this.formatDate(post.date || 'Draft')}</span>
                <span class="post-category">${post.category || 'Article'}</span>
            </div>
            <h2 class="post-title">
                <a href="${postUrl}">${post.title}</a>
            </h2>
            <p class="post-excerpt">${post.excerpt}</p>
            <div class="post-tags">${tags}</div>
            <a href="${postUrl}" class="read-more">
                Read More <i class="fas fa-arrow-right"></i>
            </a>
        `;
        
        return article;
    }

    // Render individual post
    renderPost(post) {
        // Update page title
        document.title = `${post.title} - nrclaud.io`;
        
        // Update meta description
        let metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
            metaDesc.content = post.excerpt || post.description || '';
        }
        
        // Render post header
        const postHeader = document.querySelector('.post-header');
        if (postHeader) {
            const tags = post.tags ? post.tags.map(tag => 
                `<span class="tag">${tag}</span>`
            ).join('') : '';
            
            postHeader.innerHTML = `
                <div class="post-meta">
                    <span class="post-date">${this.formatDate(post.date || 'Draft')}</span>
                    <span class="post-category">${post.category || 'Article'}</span>
                </div>
                <h1 class="post-title">${post.title}</h1>
                ${post.subtitle ? `<p class="post-subtitle">${post.subtitle}</p>` : ''}
                <div class="post-tags">${tags}</div>
            `;
        }
        
        // Render post content
        const postContent = document.querySelector('.post-content');
        if (postContent) {
            postContent.innerHTML = post.html;
            
            // Initialize syntax highlighting if available
            if (typeof hljs !== 'undefined') {
                postContent.querySelectorAll('pre code').forEach(block => {
                    hljs.highlightElement(block);
                });
            }
        }
    }

    // Format date for display
    formatDate(dateString) {
        if (dateString === 'Draft') return dateString;
        
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } catch {
            return dateString;
        }
    }
}

// Simple Markdown to HTML converter
class MarkdownConverter {
    toHtml(markdown) {
        let html = markdown;
        
        // Headers
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
        
        // Bold
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        // Italic
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        
        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
        
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // Code blocks
        html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
            const langClass = lang ? ` class="language-${lang}"` : '';
            return `<pre><code${langClass}>${this.escapeHtml(code.trim())}</code></pre>`;
        });
        
        // Simple code blocks (indented)
        html = html.replace(/^    (.*)$/gm, '<pre><code>$1</code></pre>');
        
        // Lists
        html = html.replace(/^\* (.*)$/gm, '<li>$1</li>');
        html = html.replace(/^(\d+)\. (.*)$/gm, '<li>$2</li>');
        html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
        
        // Blockquotes
        html = html.replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>');
        
        // Horizontal rules
        html = html.replace(/^---$/gm, '<hr>');
        
        // Paragraphs
        html = html.split('\n\n').map(paragraph => {
            paragraph = paragraph.trim();
            if (!paragraph) return '';
            if (paragraph.startsWith('<')) return paragraph;
            return `<p>${paragraph.replace(/\n/g, '<br>')}</p>`;
        }).join('\n');
        
        return html;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize blog on page load
document.addEventListener('DOMContentLoaded', async () => {
    const blogManager = new BlogManager();
    
    // Only try to load posts if we're on the blog index page
    if (document.querySelector('.posts-grid')) {
        try {
            await blogManager.loadPosts();
            blogManager.renderPostsList();
        } catch (error) {
            console.error('Error loading blog posts:', error);
            // Fallback: show a message or hide the posts grid
            const postsGrid = document.querySelector('.posts-grid');
            if (postsGrid) {
                postsGrid.innerHTML = '<p>Blog posts are loading...</p>';
            }
        }
    }
});

// Export for use in other scripts
window.BlogManager = BlogManager;
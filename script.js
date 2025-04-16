document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('search-input');
  const resultsContainer = document.getElementById('results-container');
  const clearButton = document.getElementById('clear-button');
  
  // Track currently selected result for keyboard navigation
  let selectedResultIndex = -1;
  let resultElements = [];
  
  // Focus the search input when popup opens
  searchInput.focus();
  
  // Initialize with empty search to show all bookmarks
  searchBookmarks('');
  
  // Debounce function to limit how often the search is performed
  let debounceTimeout;
  
  // Add event listener for search input
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    
    // Show/hide clear button based on input
    clearButton.style.display = query ? 'block' : 'none';
    
    // Clear previous timeout
    clearTimeout(debounceTimeout);
    
    // Reset selected index when search changes
    selectedResultIndex = -1;
    
    // Set new timeout to delay search execution
    debounceTimeout = setTimeout(() => {
      searchBookmarks(query);
    }, 100); // 100ms delay
  });
  
  // Add event listener for clear button
  clearButton.addEventListener('click', () => {
    searchInput.value = '';
    searchInput.focus();
    searchBookmarks('');
    clearButton.style.display = 'none';
    selectedResultIndex = -1;
  });
  
  // Add keyboard navigation
  document.addEventListener('keydown', (e) => {
    // Only handle keyboard navigation when we have results
    if (resultElements.length === 0) return;
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        navigateResults(1); // Move down
        break;
      case 'ArrowUp':
        e.preventDefault();
        navigateResults(-1); // Move up
        break;
      case 'Enter':
        e.preventDefault();
        // Open the selected bookmark if one is selected
        if (selectedResultIndex >= 0 && selectedResultIndex < resultElements.length) {
          resultElements[selectedResultIndex].click();
        }
        break;
      case 'Escape':
        e.preventDefault();
        // Clear search if there's text, otherwise close popup
        if (searchInput.value.trim()) {
          searchInput.value = '';
          searchInput.focus();
          searchBookmarks('');
          clearButton.style.display = 'none';
          selectedResultIndex = -1;
        } else {
          window.close();
        }
        break;
    }
  });
  
  // Function to navigate through results with keyboard
  function navigateResults(direction) {
    // Remove current selection
    if (selectedResultIndex >= 0 && selectedResultIndex < resultElements.length) {
      resultElements[selectedResultIndex].classList.remove('selected');
    }
    
    // Calculate new index
    selectedResultIndex += direction;
    
    // Handle wrapping
    if (selectedResultIndex < 0) {
      selectedResultIndex = resultElements.length - 1;
    } else if (selectedResultIndex >= resultElements.length) {
      selectedResultIndex = 0;
    }
    
    // Apply selection to new element
    if (selectedResultIndex >= 0 && selectedResultIndex < resultElements.length) {
      const selectedElement = resultElements[selectedResultIndex];
      selectedElement.classList.add('selected');
      
      // Scroll into view if needed
      const container = document.getElementById('results-container');
      const elementTop = selectedElement.offsetTop;
      const elementBottom = elementTop + selectedElement.offsetHeight;
      const containerTop = container.scrollTop;
      const containerBottom = containerTop + container.offsetHeight;
      
      if (elementTop < containerTop) {
        container.scrollTop = elementTop;
      } else if (elementBottom > containerBottom) {
        container.scrollTop = elementBottom - container.offsetHeight;
      }
    }
  }
  
  // Cache for regex patterns to avoid recreating them
  const regexCache = {};
  
  // Function to highlight matching text
  function highlightText(text, query) {
    if (!query) return text;
    
    // Use cached regex if available
    let regex = regexCache[query];
    
    if (!regex) {
      // Escape special characters in the query for regex
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // Create a regex pattern and cache it
      regex = new RegExp(`(${escapedQuery})`, 'gi');
      regexCache[query] = regex;
    }
    
    // Replace matching text with highlighted version
    return text.replace(regex, '<span class="highlight">$1</span>');
  }
  
  // Function to count all bookmarks
  function countAllBookmarks(nodes) {
    let count = 0;
    for (const node of nodes) {
      if (node.url) count++;
      if (node.children) count += countAllBookmarks(node.children);
    }
    return count;
  }
  
  // Calculate relevance score for sorting
  function calculateRelevanceScore(bookmark, query) {
    if (!query) return 0;
    
    const titleLower = bookmark.title.toLowerCase();
    const urlLower = bookmark.url.toLowerCase();
    let score = 0;
    
    // Exact match in title (highest priority)
    if (titleLower === query) {
      score += 100;
    }
    // Title starts with query
    else if (titleLower.startsWith(query)) {
      score += 80;
    }
    // Words in title start with query
    else if (titleLower.split(' ').some(word => word.startsWith(query))) {
      score += 60;
    }
    // Query appears anywhere in title
    else if (titleLower.includes(query)) {
      score += 40;
    }
    
    // URL contains query
    if (urlLower.includes(query)) {
      score += 30;
    }
    
    // Boost score for recently added bookmarks
    // dateAdded is in milliseconds since the epoch
    if (bookmark.dateAdded) {
      // Bookmarks added in the last 30 days get a recency boost
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      if (bookmark.dateAdded > thirtyDaysAgo) {
        // More recent bookmarks get a higher boost
        const daysAgo = (Date.now() - bookmark.dateAdded) / (24 * 60 * 60 * 1000);
        score += Math.max(0, 20 - daysAgo/1.5); // Up to 20 point boost for very recent bookmarks
      }
    }
    
    return score;
  }

  // Function to search bookmarks
  function searchBookmarks(query) {
    // Clear previous results
    resultsContainer.innerHTML = '';
    selectedResultIndex = -1;
    resultElements = [];
    
    // Get all bookmarks
    chrome.bookmarks.getTree((bookmarkTreeNodes) => {
      // Count total bookmarks (always get fresh count)
      const totalBookmarks = countAllBookmarks(bookmarkTreeNodes);
      
      // Process bookmark tree and find matches
      const matches = [];
      processBookmarkNodes(bookmarkTreeNodes, query, matches);
      
      // Sort matches by relevance if there's a query, otherwise sort by date added (most recent first)
      if (query) {
        matches.forEach(bookmark => {
          bookmark.relevanceScore = calculateRelevanceScore(bookmark, query);
        });
        
        matches.sort((a, b) => b.relevanceScore - a.relevanceScore);
      } else {
        // When not searching (empty query), sort by dateAdded (most recent first)
        matches.sort((a, b) => {
          // Handle case where dateAdded might not exist
          const dateA = a.dateAdded || 0;
          const dateB = b.dateAdded || 0;
          return dateB - dateA;
        });
      }
      
      // Limit number of displayed results for better performance
      const displayLimit = 1000;
      const displayedMatches = matches.slice(0, displayLimit);
      
      // Display results
      if (matches.length > 0) {
        // Create document fragment for better performance
        const fragment = document.createDocumentFragment();
        
        // Add results to fragment
        displayedMatches.forEach(bookmark => {
          const resultItem = document.createElement('div');
          resultItem.className = 'result-item';
          
          // Only highlight if there's a query
          let titleContent, urlContent;
          if (query) {
            titleContent = highlightText(bookmark.title, query);
            urlContent = highlightText(bookmark.url, query);
          } else {
            titleContent = bookmark.title;
            urlContent = bookmark.url;
          }
          
          resultItem.innerHTML = `
            <div class="result-title">${titleContent}</div>
            <div class="result-url">${urlContent}</div>
          `;
          
          // Store the result element for keyboard navigation
          resultElements.push(resultItem);
          
          // Add click event to open the bookmark
          resultItem.addEventListener('click', () => {
            chrome.tabs.create({ url: bookmark.url });
          });
          
          fragment.appendChild(resultItem);
        });
        
        // Append all results at once
        resultsContainer.appendChild(fragment);
        
        // Select the first result for keyboard navigation
        if (resultElements.length > 0 && query) {
          selectedResultIndex = 0;
          resultElements[0].classList.add('selected');
        }
        
        // Add result count
        const resultCount = document.createElement('div');
        resultCount.className = 'result-count';
        
        let countText = `Found ${matches.length} matching bookmarks (out of ${totalBookmarks} total)`;
        if (matches.length > displayLimit) {
          countText = `Showing ${displayLimit} of ${matches.length} matching bookmarks (${totalBookmarks} total)`;
        }
        
        resultCount.textContent = countText;
        resultsContainer.appendChild(resultCount);
      } else {
        // Display message when no results found
        resultsContainer.innerHTML = `
          <div class="no-results">
            ${query ? 'No matching favorites found' : 'You have no favorites'}
          </div>
        `;
      }
    });
  }
  
  // Recursive function to process bookmark nodes
  function processBookmarkNodes(nodes, query, matches) {
    // Early return if we already have enough matches
    const maxMatches = 1000; // Maximum number of matches to process
    if (matches.length >= maxMatches) return;
    
    for (const node of nodes) {
      // If it's a bookmark (has URL)
      if (node.url) {
        // For empty query, just add without checking (faster)
        if (!query) {
          matches.push(node);
        } 
        // Otherwise check if title or URL matches the query
        else {
          const titleLower = node.title.toLowerCase();
          const urlLower = node.url.toLowerCase();
          
          if (titleLower.includes(query) || urlLower.includes(query)) {
            matches.push(node);
          }
        }
        
        // Early return if we have enough matches
        if (matches.length >= maxMatches) return;
      }
      
      // If it has children (folder), process them recursively
      if (node.children) {
        processBookmarkNodes(node.children, query, matches);
      }
    }
  }
});

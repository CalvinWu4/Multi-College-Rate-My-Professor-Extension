let savedRecords = JSON.parse(localStorage.getItem("records"));
let savedNicknames = JSON.parse(localStorage.getItem("nicknames"));
let waitForFetch;
let restoreFirstName = false;
let restoreMiddleNames = false;

// Add ratings if there are already records saved
if (savedRecords && savedRecords.length > 0) {
    AddRatingsFromAirtable();
}
// Wait for records to be fetched before adding ratings
else{
    waitForFetch = true;
}

// Refresh nicknames and Airtable records from background fetch
chrome.runtime.onMessage.addListener(function(message) {
    // Only include records relevant to this URL
    const fetchedRecords = message.records.filter(record => 
        new URL(record.fields.URL).hostname.toLowerCase() 
        === window.location.hostname.toLowerCase());
    const fetchedNicknames = message.nicknames;

    localStorage.setItem("records", JSON.stringify(fetchedRecords));
    localStorage.setItem("nicknames", JSON.stringify(fetchedNicknames));
    savedRecords = fetchedRecords;
    savedNicknames = fetchedNicknames;
    if (waitForFetch) {
        waitForFetch = false;
        AddRatingsFromAirtable();
    }
});

// Add professor ratings god function
function AddRatingsFromAirtable() {
    const psMobileSelector = '#search-results .section-content .section-body'; // Handle PeopleSoft Mobile
    for (const [recordIndex, record] of savedRecords.entries()) {
        // Split CSS selectors by new line
        const selectors = record.fields.Selectors.split(/\r?\n/)
            .filter(selector => selector != "")
            .map(function(selector) {
                selector = selector.trim();
                if (selector.toLowerCase() === 'peoplesoft mobile') {
                    selector = psMobileSelector;
                }
                return selector;
            });

        // Add rating to a single element
        function AddRating(element) {
            let fullName = element.textContent;
            fullName = nlp(fullName).normalize({
                whitespace: true, 
                case: true, 
                punctuation: false, 
                unicode: true,
                contractions: false,
                acronyms: false, 
                parentheses: false, 
                possessives: true, 
                plurals: false,
                verbs: false,  
                honorifics: true}).out();
            fullName = fullName.replace('instructor: ', '');
            fullName = fullName.replace(parenthesesRegex, '');

            const containsLettersRegex = /[a-zA-Z]/g;

            if (fullName && containsLettersRegex.test(fullName) && fullName !== 'staff' && fullName !== 'tba' 
            && fullName !== 't.b.a.' && fullName !== 'cancel') {
                // Convert "last name, first name" to "first name last name"
                fullName = normalizeNameOrder(fullName);
                const splitName = fullName.split(' ');
                let onlyLastName;
                let firstName;
                let lastName;
                let middleNames = [];
                let originalMiddleNames = [];
                if (splitName.length > 1) {
                    firstName = splitName[0];
                    lastName = splitName.slice(-1)[0];    
                    // Handle middle names
                    if (splitName.length > 2) {
                        middleNames = [...splitName.slice(1, splitName.length-1)];
                        originalMiddleNames = [...middleNames];
                    }
                }
                else {
                    // Handle only last name given
                    onlyLastName = true;
                    lastName = fullName;
                }
                // Try with no middle names at first
                const tryMiddleNames = false;
                const tryNicknames = true;
                const tryMiddleAndLastNameCombos = true;
                const originalFirstName = firstName;
                const originalLastName = lastName;
                const nicknamesIndex = 0;
                const middleAndLastNameCombosIndex = 0;
                const tryMiddleNameAsFirst = true;
                // Handle first initial given instead of first name
                let firstInitial;
                if (firstName && isInitial(firstName)) {
                    firstInitial = firstName;
                }
                const isLastRecord = recordIndex === savedRecords.length - 1;
                // Query Rate My Professor with the professor's name
                GetProfessorRating(element, record, isLastRecord, fullName, lastName, originalLastName, firstName,
                    originalFirstName, firstInitial, onlyLastName, middleNames, originalMiddleNames, tryNicknames,
                    nicknamesIndex, tryMiddleAndLastNameCombos, middleAndLastNameCombosIndex, tryMiddleNameAsFirst,
                    tryMiddleNames);
            }
        };

        // For professor names that are loaded when the page is loaded
        [...document.querySelectorAll(selectors.join())]
            .forEach(element => AddRating(element));
        // For professor names that take time to load
        selectors.forEach(selector => {
            // Handle non-iframes
            document.arrive(selector, function(){
                if (selector === psMobileSelector) {
                    // Peoplesoft Mobile: Break up elements with multiple profs into separate elements
                    if (selectors[0] === psMobileSelector && this.textContent.includes(',')) {
                        const profs = this.textContent.replace('Instructor: ', '').split(', ');
                        for (const [profIndex, singleName] of profs.entries()) {
                            const clone = this.cloneNode(true);
                            clone.textContent = `Instructor: ${singleName}`;
                            this.textContent = this.textContent.replace(`${singleName}, `, '');
                            this.insertAdjacentElement('beforebegin', clone);
                            // Delete original element after done iterating
                            if (profIndex === profs.length - 1) {
                                this.remove();
                            }
                        }
                    }
                }
                if (selector !== psMobileSelector || 
                    (selector === psMobileSelector && this.textContent.includes('Instructor: '))) {
                    AddRating(this);
                }
            });

            // Handle iframes
            function AddRatingsToIframe(iframe){
                if (iframe.contentDocument) {
                    unloadCSS('prof-rating.css', iframe.contentDocument);
                    loadCSS('prof-rating.css', iframe.contentDocument);
                    const elements = iframe.contentDocument.querySelectorAll(selector);
                    elements.forEach(element => {
                        AddRating(element);
                    });        
                new MutationObserver(function(mutations) {
                    for(let mutation of mutations) {
                        for(let node of mutation.addedNodes) {
                                if (node instanceof HTMLElement) {
                                    if (node.querySelector(selector)) {
                                        let elements = node.querySelectorAll(selector);
                                        elements.forEach(element => {
                                            AddRating(element);
                                        });
                                    }
                                }
                            }
                        }
                    }).observe(iframe.contentDocument, {subtree: true, childList: true});
            }
            }
            document.querySelectorAll('iframe').forEach(iframe => {
                iframe.addEventListener("load", function() {
                    AddRatingsToIframe(iframe);
                });
                AddRatingsToIframe(iframe);
            });
        });
    }
}

function GetProfessorRating(element, record, isLastRecord, fullName, lastName, originalLastName, firstName,
    originalFirstName, firstInitial, onlyLastName, middleNames, originalMiddleNames, tryNicknames, nicknamesIndex,
    tryMiddleAndLastNameCombos, middleAndLastNameCombosIndex, tryMiddleNameAsFirst, tryMiddleNames) {

    // Do some normalization to help with search
    let schoolName = record.fields.College.toLowerCase().replace(':', '').replace(' - ', ' ');
    // If there are multiple colleges that use the same site, 
    // use the common substring of the college names as the schoolSiteSearchName
    let commonSchoolName;
    const collegesWithSameSite = savedRecords
        .filter(x => new URL(x.fields.URL).hostname.toLowerCase()
        === new URL(record.fields.URL).hostname.toLowerCase())
        .map(x => x.fields.College.toLowerCase());
    if (collegesWithSameSite.length > 1) {
        commonSchoolName = commonSubsequence(collegesWithSameSite);
    }
    const schoolApiSearchName = schoolName.replace(' - ', ' ');
    const schoolSiteSearchName = (commonSchoolName ? commonSchoolName : schoolName)
        .toLowerCase().replace('(', '').replace(')', '');
    const linkifyRating = record.fields["Only Add Link To Rating"];
    const lightColorLink = record.fields["Light Color Link"];
    const middleNamesString = tryMiddleNames ? middleNames.join('+') : '';
    const urlBase = 
    "https://search-production.ratemyprofessors.com/solr/rmp/select/?solrformat=true&rows=2&wt=json&q=";
    url = `${urlBase}${firstName ? firstName + '+' : ''}${middleNamesString === '' ? '' : middleNamesString + "+"}${
        tryMiddleAndLastNameCombos && middleNamesString ? '' : lastName}+AND+schoolname_t:${schoolApiSearchName}`;
    const middleAndLastNameCombos = getNameCombos(originalMiddleNames.concat(lastName));
    // Restore fields after certain iterations 
    if (restoreFirstName) {
        firstName = originalFirstName;
        restoreFirstName = false;
    }
    if (restoreMiddleNames) {
        middleNames = [...originalMiddleNames];
        restoreMiddleNames = false;
    }

    chrome.runtime.sendMessage({ url: url }, function (response) {
        const json = response.JSONresponse;
        const numFound = json.response.numFound;
        const docs = json.response.docs;
        let doc;
        if (numFound > 0) {
            if (onlyLastName) {
                // Only check last name if only last name is given
                docs.forEach(x => {
                    if (!doc && originalLastName === x.teacherlastname_t.toLowerCase()) {
                        doc = x;
                    }
                });
            }
            else {
                if (!firstInitial) {
                    doc = docs[0];
                }
                // Get the doc with a first name that matches the first initial
                else {
                    docs.forEach(x => {
                        if (!doc && originalFirstName.charAt(0) === x.teacherfirstname_t.toLowerCase().charAt(0)) {
                            doc = x;
                        }
                    });
                }
            }
        }

        function appendElement() {
            const newElem = document.createElement('a');
            
            // Linkify professor name and rating
            if (!linkifyRating) {
                // Append a link with the same text as element and clear text of original element
                newElem.textContent = element.textContent.trim() + ' ';
                element.textContent = '';
                element.appendChild(newElem);
            }
            // Only linkify professor rating
            else {
                element.textContent = element.textContent.trim() + ' ';
                element.insertAdjacentElement('afterend', newElem);
            }
            element = newElem;
            element.classList.add('prof-rating');
            element.setAttribute('target', '_blank');
            element.addEventListener('click', function (e) {
                e.stopPropagation();
            });
            if (lightColorLink) {
                element.classList.add('light-blue');
            }
        }
        
        // Add professor data if found
        if (doc) {
            const profID = doc.pk_id;
            const realFullName = doc.teacherfullname_s;
            const dept = doc.teacherdepartment_s;
            const profRating = doc.averageratingscore_rf && doc.averageratingscore_rf.toFixed(1);
            const numRatings = doc.total_number_of_ratings_i;
            const easyRating = doc.averageeasyscore_rf && doc.averageeasyscore_rf.toFixed(1);
            const profURL = "http://www.ratemyprofessors.com/ShowRatings.jsp?tid=" + profID;
            const allprofRatingsURL = "https://www.ratemyprofessors.com/paginate/professors/ratings?tid=" + profID + 
            "&page=0&max=20";

            if (!element.textContent.match(parenthesesRegex)) { // Check if a rating is already added
                appendElement();
                element.textContent = `${element.textContent} (${profRating ? profRating : 'N/A'})`;
                element.setAttribute('href', profURL);
                AddTooltip(element, allprofRatingsURL, realFullName, profRating, numRatings, easyRating, dept);
            }
        } else {
            // If the first name is simply an initial, search w/o it
            if (firstInitial && firstName !== '') {
                firstName = '';
                GetProfessorRating(element, record, isLastRecord, fullName,lastName, originalLastName, firstName,
                    originalFirstName, firstInitial, onlyLastName, middleNames, originalMiddleNames, tryNicknames,
                    nicknamesIndex, tryMiddleAndLastNameCombos, middleAndLastNameCombosIndex, tryMiddleNameAsFirst,
                    tryMiddleNames);
            }
            // Try again with only the first part of a hyphenated last name
            else if (lastName.includes("-")) {
                lastName = lastName.split('-')[0];
                GetProfessorRating(element, record, isLastRecord, fullName,lastName, originalLastName, firstName,
                    originalFirstName, firstInitial, onlyLastName, middleNames, originalMiddleNames, tryNicknames,
                    nicknamesIndex, tryMiddleAndLastNameCombos, middleAndLastNameCombosIndex, tryMiddleNameAsFirst,
                    tryMiddleNames);
            }
            // Try again with different middle and last names combos
            else if (tryMiddleNames && tryMiddleAndLastNameCombos && 
                middleAndLastNameCombos[middleAndLastNameCombosIndex]) {
                middleNames = middleAndLastNameCombos[middleAndLastNameCombosIndex];
                middleAndLastNameCombosIndex++;
                tryMiddleAndLastNameCombos = middleAndLastNameCombos[middleAndLastNameCombosIndex];
                if (!tryMiddleAndLastNameCombos) {
                    restoreMiddleNames = true;
                }
                GetProfessorRating(element, record, isLastRecord, fullName,lastName, originalLastName, firstName,
                    originalFirstName, firstInitial, onlyLastName, middleNames, originalMiddleNames, tryNicknames,
                    nicknamesIndex, tryMiddleAndLastNameCombos, middleAndLastNameCombosIndex, tryMiddleNameAsFirst,
                    tryMiddleNames);
            }
            // Try again with nicknames for the first name
            else if (tryNicknames && savedNicknames[originalFirstName]) {
                firstName = savedNicknames[originalFirstName][nicknamesIndex];
                nicknamesIndex++;
                tryNicknames = savedNicknames[originalFirstName][nicknamesIndex];
                if (!tryNicknames) {
                    restoreFirstName = true;
                }
                GetProfessorRating(element, record, isLastRecord, fullName,lastName, originalLastName, firstName,
                    originalFirstName, firstInitial, onlyLastName, middleNames, originalMiddleNames, tryNicknames,
                    nicknamesIndex, tryMiddleAndLastNameCombos, middleAndLastNameCombosIndex, tryMiddleNameAsFirst,
                    tryMiddleNames);
            }
            // Try again with the middle name as the first name
            else if (tryMiddleNameAsFirst && !tryMiddleNames && originalMiddleNames.length > 0) {
                firstName = originalMiddleNames[0];
                tryMiddleNameAsFirst = false;
                restoreFirstName = true;
                GetProfessorRating(element, record, isLastRecord, fullName,lastName, originalLastName, firstName,
                    originalFirstName, firstInitial, onlyLastName, middleNames, originalMiddleNames, tryNicknames,
                    nicknamesIndex, tryMiddleAndLastNameCombos, middleAndLastNameCombosIndex, tryMiddleNameAsFirst,
                    tryMiddleNames);
            }
            // Try again with middle names
            else if (!tryMiddleNames && originalMiddleNames.length > 0) {
                tryMiddleNames = true;
                GetProfessorRating(element, record, isLastRecord, fullName,lastName, originalLastName, firstName,
                    originalFirstName, firstInitial, onlyLastName, middleNames, originalMiddleNames, tryNicknames,
                    nicknamesIndex, tryMiddleAndLastNameCombos, middleAndLastNameCombosIndex, tryMiddleNameAsFirst,
                    tryMiddleNames);
            }
            // Set link to search results if not found
            else {
                // Search all records first
                if (isLastRecord && !element.textContent.match(parenthesesRegex)) {
                    appendElement();
                    element.textContent = `${element.textContent} (NF)`;
                    element.setAttribute('href', 
                    `https://www.ratemyprofessors.com/search.jsp?queryBy=teacherName&queryoption=HEADER&query=${
                        originalLastName}&facetSearch=true&schoolName=${schoolSiteSearchName}`);
                }
            }
        }        
    });
}

function AddTooltip(element, allprofRatingsURL, realFullName, profRating, numRatings, easyRating, dept) {
    let ratings = [];
    function getRatings(url){
        chrome.runtime.sendMessage({ url: url }, function (response) { 
            ratings = ratings.concat(response.JSONresponse.ratings);
            var remaining = response.JSONresponse.remaining;
            let pageNum = parseInt(new URLSearchParams(url).get('page'));
            if(remaining !== 0) { 
                // Get all ratings by going through all the pages
                getRatings(url.replace(`page=${pageNum}`, `page=${pageNum + 1}`));
            }
            else{
                // Build content for professor tooltip
                let wouldTakeAgain = 0;
                let wouldTakeAgainNACount = 0;
                let mostHelpfulReview;
                let helpCount;
                let notHelpCount;
                let wouldTakeAgainText;
                let easyRatingText;

                const div = document.createElement("div");
                const title = document.createElement("div");
                title.classList.add("prof-rating-title");
                title.textContent = "Rate My Professor Details";
                div.appendChild(title);
                const professorText = document.createElement("div");
                professorText.classList.add("prof-rating-text");
                professorText.textContent = `${realFullName}, Professor in ${dept}`;
                div.appendChild(professorText);
                const avgRatingText = document.createElement("div");
                avgRatingText.classList.add("prof-rating-text");
                avgRatingText.textContent = `Overall Quality: ${profRating ? profRating : 'N/A'}/5`
                div.appendChild(avgRatingText);
                const numRatingsText = document.createElement("div");
                numRatingsText.classList.add("prof-rating-text");
                numRatingsText.textContent = `Number of Ratings: ${numRatings}`
                div.appendChild(numRatingsText);

                if (ratings.length > 0) {
                    let tagFreqMap = new Map();
                    for (let i = 0; i < ratings.length; i++) {
                        let rating = ratings[i];
                        if (rating.rWouldTakeAgain === "Yes") {
                            wouldTakeAgain++;
                        } else if (rating.rWouldTakeAgain === "N/A") {
                            wouldTakeAgainNACount++;
                        }

                        let teacherRatingTags = rating.teacherRatingTags;
                        for (let j = 0; j < teacherRatingTags.length; j++) {
                            let tag = teacherRatingTags[j];
                            if (tagFreqMap.get(tag)){
                                tagFreqMap.get(tag).count++;
                            }
                            else{
                                tagFreqMap.set(tag, { count: 0 });
                            }
                        }
                    }

                    ratings.sort(function(a,b) { return new Date(b.rDate) - new Date(a.rDate) });
                    ratings.sort(function(a,b) { 
                        return (b.helpCount - b.notHelpCount) - (a.helpCount - a.notHelpCount) 
                    });
                    mostHelpfulReview = ratings[0];
                    helpCount = mostHelpfulReview.helpCount;
                    notHelpCount = mostHelpfulReview.notHelpCount;

                    const topTags = ([...tagFreqMap.entries()].sort((a, b) => a.count - b.count)).splice(0, 5);
                    easyRatingText = document.createElement("div");
                    easyRatingText.classList.add("prof-rating-text");
                    easyRatingText.textContent = `Level of Difficulty: ${easyRating}`;
                    div.appendChild(easyRatingText);
                    wouldTakeAgainText = document.createElement("div");
                    wouldTakeAgainText.classList.add("prof-rating-text");
                    if (ratings.length >= 8 && wouldTakeAgainNACount < (ratings.length / 2)) {
                        wouldTakeAgain = `${((wouldTakeAgain / (ratings.length - wouldTakeAgainNACount)) * 100)
                            .toFixed(0).toString()}%`;
                    } else {
                        wouldTakeAgain = "N/A";
                    }
                    wouldTakeAgainText.textContent = "Would take again: " + wouldTakeAgain;
                    div.appendChild(wouldTakeAgainText);
                    const topTagsText = document.createElement("div");
                    topTagsText.classList.add("prof-rating-text");
                    topTagsText.textContent = "Top Tags: ";
                    if (topTags.length > 0) {
                        for (let i = 0; i < topTags.length; i++) {
                            let tag = topTags[i][0];
                            topTagsText.textContent += `${tag}${i !== topTags.length - 1 ? ", " : ""}`;
                        }
                        div.appendChild(topTagsText);
                    }
                    div.appendChild(document.createElement("br"));
                }
                if (mostHelpfulReview) {
                    const classText = document.createElement("div");
                    classText.classList.add("prof-rating-text");
                    classText.textContent = "Most Helpful Rating: " + mostHelpfulReview.rClass + 
                    (mostHelpfulReview.onlineClass === "online" ? " (Online)" : "");  // Mark if class was online
                    div.appendChild(classText);
                    const dateText = document.createElement("div");
                    dateText.classList.add("prof-rating-text");
                    dateText.textContent = mostHelpfulReview.rDate;
                    div.appendChild(dateText);
                    const profRating = document.createElement("div");
                    profRating.classList.add("prof-rating-text");
                    profRating.textContent = "Overall Quality: " + mostHelpfulReview.rOverallString;
                    div.appendChild(profRating);
                    const thisEasyRating = document.createElement("div");
                    thisEasyRating.classList.add("prof-rating-text");
                    thisEasyRating.textContent = "Level of Difficulty: " + mostHelpfulReview.rEasyString;
                    div.appendChild(thisEasyRating);
                    if (mostHelpfulReview.rWouldTakeAgain !== "N/A") {
                        const thisWouldTakeAgain = document.createElement("div");
                        thisWouldTakeAgain.classList.add("prof-rating-text");
                        thisWouldTakeAgain.textContent = "Would take again: " + mostHelpfulReview.rWouldTakeAgain;
                        div.appendChild(thisWouldTakeAgain);
                    }
                    const commentText = document.createElement("div");
                    commentText.classList.add("prof-rating-text");
                    commentText.textContent = mostHelpfulReview.rComments;
                    div.appendChild(commentText);
                    const tagsText = document.createElement("div");
                    tagsText.classList.add("prof-rating-text");
                    tagsText.textContent = "Tags: "
                    const tags = mostHelpfulReview.teacherRatingTags;
                    if (tags.length > 0) {
                        for (let i = 0; i < tags.length; i++) {
                            let tag = tags[i];
                            tagsText.textContent += `${tag}${i !== tags.length - 1 ? ", " : ""}`;
                        }
                        div.appendChild(tagsText);
                    }
                    const upvotesText = document.createElement("div");
                    upvotesText.classList.add("prof-rating-text");
                    upvotesText.textContent = `👍${helpCount} 👎${notHelpCount}`;
                    div.appendChild(upvotesText);
                }
                tippy(element, {
                    theme: 'light',
                    allowHTML: true,
                    placement: 'right',
                    // show delay is 500ms, hide delay is 0ms
                    delay: [500, 0],
                    onShow: function(instance) {
                        instance.setContent(div);        
                    }
                });
            }
        });
    }
    getRatings(allprofRatingsURL);
}
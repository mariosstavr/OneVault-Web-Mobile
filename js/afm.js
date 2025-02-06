// afm.js
async function fetchFolderStructure() {
    try {
        const response = await fetch(`/get-afm-folder-structure/${vat}`);
        const filesData = await response.json();
        renderFolderContents(filesData, document.getElementById('file-grid'), document.getElementById('file-details-body'));
    } catch (error) {
        console.error('Error fetching folder structure:', error);
        alert('Error fetching files. Please try again later.');
    }
}


function renderFolderContents(filesData, gridContainer, detailsContainer) {
    gridContainer.innerHTML = '';
    detailsContainer.innerHTML = '';

    filesData.forEach(file => {
        
        const fileItem = document.createElement('div');
        fileItem.classList.add('file-item');
        fileItem.onclick = () => previewFile(file); 

        const iconSpan = document.createElement('span');
        iconSpan.classList.add('file-icon');

        if (file.type === 'folder') {
            iconSpan.textContent = '📂';
        } else {
            iconSpan.textContent = '📄';
        }

        const fileName = document.createElement('div');
        fileName.classList.add('file-name');
        fileName.textContent = file.name;

        const downloadContainer = document.createElement('div');
        downloadContainer.classList.add('download-container');

        if (file.type === 'file') {
            const link = document.createElement('a');
            link.href = `/download-afm/${encodeURIComponent(file.name)}`; 
            link.download = file.name; 
            link.textContent = '⬇ Κατέβασμα';
            link.classList.add('download-link');
            link.onclick = (event) => event.stopPropagation();
        
            downloadContainer.appendChild(link);
        }
        
        

        fileItem.appendChild(iconSpan);
        fileItem.appendChild(fileName);
        fileItem.appendChild(downloadContainer);
        gridContainer.appendChild(fileItem);

        // Details View Row
        const detailsRow = document.createElement('tr');
        const modifiedDate = file.lastModifiedDateTime ? formatDateToGreekLocale(file.lastModifiedDateTime) : 'Unknown';

        detailsRow.innerHTML = `
            <td data-label="Όνομα">${file.name}</td>
            <td data-label="date">${modifiedDate}</td>
            <td data-label="download">
                <a href="/download/${encodeURIComponent(file.name)}" class="download-link">⬇ Κατέβασμα</a>
            </td>
        `;
        
        
        detailsRow.querySelector('.download-link').onclick = (event) => event.stopPropagation();
        
        detailsRow.onclick = () => previewFile(file); 
        detailsContainer.appendChild(detailsRow);
    });
}


function formatDateToGreekLocale(isoDate) {
    const date = new Date(isoDate);
    const formattedDate = date.toLocaleDateString('el-GR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
    const formattedTime = date.toLocaleTimeString('el-GR', {
        hour: '2-digit',
        minute: '2-digit'
    });
    return `${formattedDate} ${formattedTime}`;
}


let pdfDocument = null;
let currentPage = 1;
let totalPages = 0;


function renderPage(pageNumber) {
    const pdfCanvas = document.getElementById('pdfCanvas');
    const canvasContext = pdfCanvas.getContext('2d');

    pdfDocument.getPage(pageNumber).then(page => {
        const viewport = page.getViewport({ scale: 1.5 });
        pdfCanvas.height = viewport.height;
        pdfCanvas.width = viewport.width;

        const renderContext = {
            canvasContext: canvasContext,
            viewport: viewport
        };
        page.render(renderContext);
    });

    document.getElementById('pageNumber').textContent = pageNumber;
}


function renderPDF(pdfUrl) {
    return new Promise((resolve, reject) => {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);

        loadingTask.promise.then(pdf => {
            pdfDocument = pdf;
            totalPages = pdf.numPages;
            document.getElementById('totalPages').textContent = totalPages;
            renderPage(currentPage);
            document.getElementById('pdfCanvas').style.display = 'block';
            document.getElementById('pdfNavigation').style.display = 'block';
            resolve(); 
        }).catch(reason => {
            console.error('Error loading PDF:', reason);
            reject(reason); 
        });
    });
}


document.getElementById('prevPageButton').addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        renderPage(currentPage);
    }
});

document.getElementById('nextPageButton').addEventListener('click', () => {
    if (currentPage < totalPages) {
        currentPage++;
        renderPage(currentPage);
    }
});


function resetModal() {
    const modalContent = document.getElementById('modalContent');
    const pdfCanvas = document.getElementById('pdfCanvas');
    const pdfNavigation = document.getElementById('pdfNavigation');
    const modalImage = document.getElementById('modalImage');

    
    modalContent.innerHTML = '';
    pdfCanvas.style.display = 'none';
    pdfNavigation.style.display = 'none';
    modalImage.style.display = 'none';
    modalImage.src = '';

    
    pdfDocument = null;
    currentPage = 1;
    totalPages = 0;
}


async function previewFile(file) {
    const modal = document.getElementById('modal');
    const modalContent = document.getElementById('modalContent');
    const pdfCanvas = document.getElementById('pdfCanvas');
    const pdfNavigation = document.getElementById('pdfNavigation');
    const modalImage = document.getElementById('modalImage');

    
    resetModal();

    const fileUrl = `/download-afm/${encodeURIComponent(file.name)}`;

    
    toggleSpinner(true);

    try {
        if (file.name.endsWith('.pdf')) {
            currentPage = 1;
            await renderPDF(fileUrl);
        } else if (file.name.match(/\.(jpg|jpeg|png|gif)$/i)) {
            modalImage.src = fileUrl;
            modalImage.style.display = 'block';
        } else if (file.name.endsWith('.txt')) {
            const response = await fetch(fileUrl);
            const text = await response.text();
            const pre = document.createElement('pre');
            pre.textContent = text;
            modalContent.appendChild(pre);
        } else if (file.name.endsWith('.docx')) {
            const response = await fetch(fileUrl);
            const buffer = await response.arrayBuffer();
            const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
            modalContent.innerHTML = `<div>${result.value}</div>`;
        } else if (file.name.endsWith('.xlsx')) {
            const response = await fetch(fileUrl);
            const buffer = await response.arrayBuffer();
            const data = new Uint8Array(buffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const firstSheet = workbook.Sheets[firstSheetName];
            modalContent.innerHTML = XLSX.utils.sheet_to_html(firstSheet);
        } else {
            alert('Unsupported file type for preview');
            toggleSpinner(false); 
            return; 
        }
          
          modal.style.display = 'block';
    } catch (err) {
        console.error('Error loading file:', err);
        alert('Error loading file. Please try again later.');
    } finally {
        toggleSpinner(false); 
    }

   
    modal.style.display = 'flex';
    modal.classList.add('show');
}


function closeModal() {
    const modal = document.getElementById('modal');
    modal.classList.remove('show');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300); 
}


function toggleSpinner(show) {
    const spinner = document.querySelector('.loading-spinner');
    spinner.style.display = show ? 'block' : 'none';
}


function toggleView() {
   
    if (window.innerWidth > 600) {
        const grid = document.getElementById('file-grid');
        const details = document.getElementById('file-details');
        const toggleButton = document.querySelector('.view-toggle');

        if (grid.style.display === 'none') {
            grid.style.display = 'grid';
            details.style.display = 'none';
            toggleButton.textContent = 'DETAILS ';
        } else {
            grid.style.display = 'none';
            details.style.display = 'block';
            toggleButton.textContent = 'LARGE ICONS';
        }
    }
}


window.addEventListener('resize', function() {
    const grid = document.getElementById('file-grid');
    const details = document.getElementById('file-details');
    const toggleButton = document.querySelector('.view-toggle');

    if (window.innerWidth <= 600) {
       
        grid.style.display = 'grid';
        details.style.display = 'none';
        toggleButton.style.display = 'none';
    } else {
        
        toggleButton.style.display = 'inline-block';
    }
});

function toggleMenu() {
    const menu = document.querySelector('.menu');
    menu.classList.toggle('open');
}


document.addEventListener('click', (event) => {
    const menu = document.querySelector('.menu');
    const menuToggle = document.querySelector('.menu-toggle');

    if (menu.classList.contains('open') && !menu.contains(event.target) && !menuToggle.contains(event.target)) {
        menu.classList.remove('open');
    }
});


document.addEventListener('DOMContentLoaded', function() {
    fetchFolderStructure();
    
    window.dispatchEvent(new Event('resize'));
});


document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closeModal();
    }
});


document.getElementById('modal').addEventListener('click', (event) => {
    const modalContent = document.querySelector('.modal-content');
    
    
    if (!modalContent.contains(event.target)) {
        closeModal();
    }
});

let sortOrder = { name: 'asc', date: 'asc' };

function sortTable(column) {
    const tableBody = document.getElementById("file-details-body");
    const rows = Array.from(tableBody.querySelectorAll("tr"));

    
    const isAscending = sortOrder[column] === 'asc';
    sortOrder[column] = isAscending ? 'desc' : 'asc';

    let compareFunction;

    if (column === 'name') {
        compareFunction = (a, b) => {
            const nameA = a.querySelector('td:nth-child(1)').textContent.trim().toLowerCase();
            const nameB = b.querySelector('td:nth-child(1)').textContent.trim().toLowerCase();
            return isAscending ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
        };
    } else if (column === 'date') {
        compareFunction = (a, b) => {
            const dateA = parseCustomDate(a.querySelector('td:nth-child(2)').textContent.trim());
            const dateB = parseCustomDate(b.querySelector('td:nth-child(2)').textContent.trim());
            return isAscending ? dateA - dateB : dateB - dateA;
        };
    }

    
    rows.sort(compareFunction).forEach(row => tableBody.appendChild(row));

    
    updateSortArrows(column, isAscending);
}

function parseCustomDate(dateString) {
    const [datePart, timePart] = dateString.split(' ');
    const [day, month, year] = datePart.split('/').map(Number);

    const [time, meridian] = [timePart.slice(0, 5), timePart.slice(-3)];
    let [hours, minutes] = time.split(':').map(Number);

    if (meridian === 'μ.μ.' && hours < 12) {
        hours += 12;
    } else if (meridian === 'π.μ.' && hours === 12) {
        hours = 0;
    }

    return new Date(year, month - 1, day, hours, minutes);
}

function updateSortArrows(column, isAscending) {
    
    document.querySelectorAll('th').forEach(header => {
        header.classList.remove('sorted', 'asc', 'desc');
    });

    
    const header = document.getElementById(`${column}-header`);
    header.classList.add('sorted', isAscending ? 'asc' : 'desc');
}

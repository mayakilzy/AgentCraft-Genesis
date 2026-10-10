// DOM Elements
const createProjectForm = document.getElementById('create-project-form');
const createTaskForm = document.getElementById('create-task-form');
const projectsContainer = document.getElementById('projects-container');
const tasksContainer = document.getElementById('tasks-container');
const projectDetailSection = document.getElementById('project-detail');
const projectListSection = document.querySelector('.project-list');
const backToProjectsBtn = document.getElementById('back-to-projects');
const messageContainer = document.getElementById('message-container');
const filterButtons = document.querySelectorAll('.filter-btn');

// State
let projects = [];
let tasks = [];
let currentFilter = 'all';
let selectedProjectId = null;

// API Base URL
const API_BASE_URL = 'http://localhost:3000/api';

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  fetchProjects();
  setupEventListeners();
});

// Setup Event Listeners
function setupEventListeners() {
  createProjectForm.addEventListener('submit', handleCreateProject);
  createTaskForm.addEventListener('submit', handleCreateTask);
  backToProjectsBtn.addEventListener('click', showProjectList);
  
  filterButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Update active filter button
      filterButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      
      // Set current filter and fetch projects
      currentFilter = button.dataset.filter;
      fetchProjects();
    });
  });
}

// Show Message
function showMessage(message, type = 'success') {
  const messageEl = document.createElement('div');
  messageEl.className = `message ${type}`;
  messageEl.textContent = message;
  
  messageContainer.innerHTML = '';
  messageContainer.appendChild(messageEl);
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    messageEl.remove();
  }, 3000);
}

// Fetch Projects
async function fetchProjects() {
  try {
    const response = await fetch(`${API_BASE_URL}/projects`);
    const result = await response.json();
    
    if (result.ok) {
      projects = result.data;
      renderProjects();
    } else {
      showMessage(result.error, 'error');
    }
  } catch (error) {
    showMessage('Failed to fetch projects', 'error');
    console.error('Error fetching projects:', error);
  }
}

// Fetch Tasks for a Project
async function fetchTasks(projectId) {
  try {
    const response = await fetch(`${API_BASE_URL}/projects/${projectId}/tasks`);
    const result = await response.json();
    
    if (result.ok) {
      tasks = result.data;
      renderTasks();
    } else {
      showMessage(result.error, 'error');
    }
  } catch (error) {
    showMessage('Failed to fetch tasks', 'error');
    console.error('Error fetching tasks:', error);
  }
}

// Render Projects
function renderProjects() {
  projectsContainer.innerHTML = '';
  
  // Filter projects based on current filter
  let filteredProjects = projects;
  if (currentFilter === 'active') {
    filteredProjects = projects.filter(p => p.status === 'active');
  } else if (currentFilter === 'archived') {
    filteredProjects = projects.filter(p => p.status === 'archived');
  }
  
  if (filteredProjects.length === 0) {
    projectsContainer.innerHTML = '<div class="empty-state">No projects found</div>';
    return;
  }
  
  filteredProjects.forEach(project => {
    const projectCard = document.createElement('div');
    projectCard.className = 'project-card';
    
    const statusClass = `status-${project.status}`;
    
    projectCard.innerHTML = `
      <div class="project-header">
        <div>
          <h3 class="project-name">${escapeHtml(project.name)}</h3>
          <span class="status-badge ${statusClass}">${formatStatus(project.status)}</span>
        </div>
        <button class="view-project-btn" data-id="${project.id}">View</button>
      </div>
      ${project.description ? `<p>${escapeHtml(project.description)}</p>` : ''}
    `;
    
    const viewBtn = projectCard.querySelector('.view-project-btn');
    viewBtn.addEventListener('click', () => showProjectDetail(project.id));
    
    projectsContainer.appendChild(projectCard);
  });
}

// Render Tasks
function renderTasks() {
  tasksContainer.innerHTML = '';
  
  if (tasks.length === 0) {
    tasksContainer.innerHTML = '<div class="empty-state">No tasks found</div>';
    return;
  }
  
  tasks.forEach(task => {
    const taskCard = document.createElement('div');
    taskCard.className = 'task-card';
    
    const statusClass = `status-${task.status}`;
    
    taskCard.innerHTML = `
      <div class="task-title">${escapeHtml(task.title)}</div>
      ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ''}
      <div>
        <label for="task-status-${task.id}">Status:</label>
        <select 
          id="task-status-${task.id}" 
          class="task-status-select" 
          data-id="${task.id}"
          data-current-status="${task.status}"
        >
          <option value="todo" ${task.status === 'todo' ? 'selected' : ''}>To Do</option>
          <option value="in-progress" ${task.status === 'in-progress' ? 'selected' : ''}>In Progress</option>
          <option value="done" ${task.status === 'done' ? 'selected' : ''}>Done</option>
        </select>
      </div>
    `;
    
    const statusSelect = taskCard.querySelector('.task-status-select');
    statusSelect.addEventListener('change', (e) => updateTaskStatus(task.id, e.target.value));
    
    tasksContainer.appendChild(taskCard);
  });
}

// Handle Create Project
async function handleCreateProject(e) {
  e.preventDefault();
  
  const nameInput = document.getElementById('project-name');
  const descriptionInput = document.getElementById('project-description');
  
  const projectData = {
    name: nameInput.value.trim(),
    description: descriptionInput.value.trim()
  };
  
  try {
    const response = await fetch(`${API_BASE_URL}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(projectData)
    });
    
    const result = await response.json();
    
    if (result.ok) {
      showMessage('Project created successfully');
      nameInput.value = '';
      descriptionInput.value = '';
      fetchProjects();
    } else {
      showMessage(result.error, 'error');
    }
  } catch (error) {
    showMessage('Failed to create project', 'error');
    console.error('Error creating project:', error);
  }
}

// Handle Create Task
async function handleCreateTask(e) {
  e.preventDefault();
  
  const titleInput = document.getElementById('task-title');
  const descriptionInput = document.getElementById('task-description');
  const projectIdInput = document.getElementById('task-project-id');
  
  const taskData = {
    title: titleInput.value.trim(),
    description: descriptionInput.value.trim()
  };
  
  try {
    const response = await fetch(`${API_BASE_URL}/projects/${projectIdInput.value}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(taskData)
    });
    
    const result = await response.json();
    
    if (result.ok) {
      showMessage('Task created successfully');
      titleInput.value = '';
      descriptionInput.value = '';
      fetchTasks(projectIdInput.value);
    } else {
      showMessage(result.error, 'error');
    }
  } catch (error) {
    showMessage('Failed to create task', 'error');
    console.error('Error creating task:', error);
  }
}

// Update Task Status
async function updateTaskStatus(taskId, newStatus) {
  try {
    const response = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: newStatus })
    });
    
    const result = await response.json();
    
    if (result.ok) {
      showMessage('Task status updated');
      // Update the task in our local state
      const taskIndex = tasks.findIndex(t => t.id === taskId);
      if (taskIndex !== -1) {
        tasks[taskIndex].status = newStatus;
      }
    } else {
      showMessage(result.error, 'error');
      // Revert the select value
      const taskElement = document.querySelector(`#task-status-${taskId}`);
      if (taskElement) {
        taskElement.value = taskElement.dataset.currentStatus;
      }
    }
  } catch (error) {
    showMessage('Failed to update task status', 'error');
    console.error('Error updating task status:', error);
  }
}

// Show Project Detail
async function showProjectDetail(projectId) {
  selectedProjectId = projectId;
  
  // Find the project
  const project = projects.find(p => p.id === projectId);
  if (!project) return;
  
  // Update project detail section
  document.getElementById('detail-project-name').textContent = project.name;
  document.getElementById('detail-project-description').textContent = project.description || 'No description';
  document.getElementById('task-project-id').value = projectId;
  
  // Show project detail, hide project list
  projectListSection.style.display = 'none';
  projectDetailSection.style.display = 'block';
  
  // Fetch and render tasks for this project
  fetchTasks(projectId);
}

// Show Project List
function showProjectList() {
  projectListSection.style.display = 'block';
  projectDetailSection.style.display = 'none';
  selectedProjectId = null;
}

// Helper Functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatStatus(status) {
  return status.split('-').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

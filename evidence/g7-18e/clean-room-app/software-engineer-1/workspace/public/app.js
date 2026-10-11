// DOM Elements
const createProjectForm = document.getElementById('create-project-form');
const projectsList = document.getElementById('projects-list');
const projectDetailSection = document.getElementById('project-detail');
const projectDetailHeader = document.getElementById('project-detail-header');
const createTaskForm = document.getElementById('create-task-form');
const tasksList = document.getElementById('tasks-list');
const backToProjectsBtn = document.getElementById('back-to-projects');
const messageArea = document.getElementById('message-area');
const statusFilterBtns = document.querySelectorAll('.filter-btn');

// State
let currentProject = null;
let currentFilter = 'all';

// API Helper
const apiCall = async (endpoint, options = {}) => {
  const url = `/api${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'API request failed');
  }

  return response.json();
};

// Message Helper
const showMessage = (message, type = 'success') => {
  const messageEl = document.createElement('div');
  messageEl.className = `message ${type}`;
  messageEl.textContent = message;
  messageArea.appendChild(messageEl);

  setTimeout(() => {
    messageEl.remove();
  }, 3000);
};

// Project Functions
const renderProjects = async () => {
  try {
    const { data: projects } = await apiCall('/projects');
    
    if (projects.length === 0) {
      projectsList.innerHTML = '<div class="empty-state"><p>No projects yet. Create your first project!</p></div>';
      return;
    }

    projectsList.innerHTML = projects
      .filter(project => {
        if (currentFilter === 'all') return true;
        return project.status === currentFilter;
      })
      .map(project => `
        <div class="project-card">
          <h3>${project.name}</h3>
          <p>${project.description || 'No description'}</p>
          <span class="project-status status-${project.status}">${project.status}</span>
          <button class="view-project-btn" data-id="${project.id}">View</button>
        </div>
      `)
      .join('');

    // Add event listeners to view buttons
    document.querySelectorAll('.view-project-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const projectId = btn.getAttribute('data-id');
        showProjectDetail(projectId);
      });
    });
  } catch (error) {
    showMessage(error.message, 'error');
  }
};

const createProject = async (e) => {
  e.preventDefault();
  
  const formData = new FormData(createProjectForm);
  const projectData = {
    name: formData.get('name').trim(),
    description: formData.get('description').trim(),
  };

  try {
    const { data } = await apiCall('/projects', {
      method: 'POST',
      body: JSON.stringify(projectData),
    });

    showMessage('Project created successfully!');
    createProjectForm.reset();
    renderProjects();
  } catch (error) {
    showMessage(error.message, 'error');
  }
};

const showProjectDetail = async (projectId) => {
  try {
    const { data: project } = await apiCall(`/projects/${projectId}`);
    currentProject = project;
    
    projectDetailHeader.innerHTML = `
      <h2>${project.name}</h2>
      <p>${project.description || 'No description'}</p>
      <span class="project-status status-${project.status}">${project.status}</span>
    `;

    projectDetailSection.style.display = 'block';
    window.scrollTo(0, 0);
    
    renderTasks(projectId);
  } catch (error) {
    showMessage(error.message, 'error');
  }
};

// Task Functions
const renderTasks = async (projectId) => {
  try {
    const { data: tasks } = await apiCall(`/projects/${projectId}/tasks`);
    
    if (tasks.length === 0) {
      tasksList.innerHTML = '<div class="empty-state"><p>No tasks yet. Create your first task!</p></div>';
      return;
    }

    tasksList.innerHTML = tasks
      .map(task => `
        <div class="task-item">
          <h4>${task.title}</h4>
          <p>${task.description || 'No description'}</p>
          <div>
            <label for="task-status-${task.id}">Status:</label>
            <select 
              id="task-status-${task.id}" 
              class="task-status-select" 
              data-id="${task.id}"
              value="${task.status}"
            >
              <option value="todo" ${task.status === 'todo' ? 'selected' : ''}>To Do</option>
              <option value="in-progress" ${task.status === 'in-progress' ? 'selected' : ''}>In Progress</option>
              <option value="done" ${task.status === 'done' ? 'selected' : ''}>Done</option>
            </select>
          </div>
        </div>
      `)
      .join('');

    // Add event listeners to status dropdowns
    document.querySelectorAll('.task-status-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const taskId = e.target.getAttribute('data-id');
        const newStatus = e.target.value;
        updateTaskStatus(taskId, newStatus);
      });
    });
  } catch (error) {
    showMessage(error.message, 'error');
  }
};

const createTask = async (e) => {
  e.preventDefault();
  
  if (!currentProject) return;
  
  const formData = new FormData(createTaskForm);
  const taskData = {
    title: formData.get('title').trim(),
    description: formData.get('description').trim(),
  };

  try {
    const { data } = await apiCall(`/projects/${currentProject.id}/tasks`, {
      method: 'POST',
      body: JSON.stringify(taskData),
    });

    showMessage('Task created successfully!');
    createTaskForm.reset();
    renderTasks(currentProject.id);
  } catch (error) {
    showMessage(error.message, 'error');
  }
};

const updateTaskStatus = async (taskId, newStatus) => {
  try {
    const { data } = await apiCall(`/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    });

    showMessage('Task status updated successfully!');
  } catch (error) {
    showMessage(error.message, 'error');
  }
};

// Event Listeners
createProjectForm.addEventListener('submit', createProject);
createTaskForm.addEventListener('submit', createTask);
backToProjectsBtn.addEventListener('click', () => {
  projectDetailSection.style.display = 'none';
  currentProject = null;
  renderProjects();
});

statusFilterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    statusFilterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.getAttribute('data-status');
    renderProjects();
  });
});

// Initial Load
renderProjects();
import { Montserrat_400Regular, Montserrat_600SemiBold, Montserrat_700Bold, useFonts } from '@expo-google-fonts/montserrat';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Accelerometer } from 'expo-sensors';
import * as SplashScreen from 'expo-splash-screen';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

SplashScreen.preventAutoHideAsync();

// ============================================================================
// Type Definitions
// ============================================================================

type Priority = 'low' | 'normal' | 'high' | 'urgent';

interface Task {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  priority: Priority;
}

interface Particle {
  id: string;
  x: Animated.Value;
  y: Animated.Value;
  opacity: Animated.Value;
  color: string;
}

interface Theme {
  colors: [string, string, ...string[]];
  accent: string;
  text: string;
  name: string;
}

// ============================================================================
// Constants & Configuration
// ============================================================================

const PARTICLE_COUNT = 15;
const PARTICLE_ANIMATION_DURATION = 600;
const PARTICLE_VELOCITY_BASE = 50;
const PARTICLE_VELOCITY_RANGE = 50;
const SHAKE_THRESHOLD = 2.5;
const SHAKE_COOLDOWN = 1000;
const THEME_UPDATE_INTERVAL = 60000; // 1 minute

const PARTICLE_COLORS = ['#FF6B9D', '#4ECDC4', '#FFE66D', '#A8E6CF', '#FF8B94'];

const PRIORITY_CONFIG = {
  urgent: { color: '#FF4757', glow: true },
  high: { color: '#FFA502', glow: false },
  normal: { color: '#5F27CD', glow: false },
  low: { color: '#A4B0BE', glow: false },
} as const;

const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent'];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Returns a theme configuration based on current time of day
 */
const getTimeBasedTheme = (): Theme => {
  const hour = new Date().getHours();
  
  if (hour >= 6 && hour < 12) {
    return {
      colors: ['#FFE5E5', '#FFF0E5', '#E5F3FF'],
      accent: '#FF6B9D',
      text: '#2D3436',
      name: 'Morning',
    };
  } else if (hour >= 12 && hour < 18) {
    return {
      colors: ['#A8E6CF', '#FFD3B6', '#FFAAA5'],
      accent: '#FF8B94',
      text: '#2D3436',
      name: 'Afternoon',
    };
  } else if (hour >= 18 && hour < 22) {
    return {
      colors: ['#FF6B6B', '#FFA07A', '#FFD700'],
      accent: '#FF4757',
      text: '#2D3436',
      name: 'Evening',
    };
  } else {
    return {
      colors: ['#1e3c72', '#2a5298', '#7474bf'],
      accent: '#A29BFE',
      text: '#FFFFFF',
      name: 'Night',
    };
  }
};

/**
 * Triggers haptic feedback with fallback for web platform
 */
const triggerHaptic = (type: 'light' | 'medium' | 'success' | 'warning' | 'error'): void => {
  if (Platform.OS === 'web') return;
  
  const hapticMap = {
    light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
    medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
    success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
    error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  };
  
  hapticMap[type]();
};

// ============================================================================
// Main Component
// ============================================================================

export default function TaskManager() {
  // Font loading
  const [fontsLoaded] = useFonts({
    Montserrat_400Regular,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
  });

  // Task state management
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [selectedPriority, setSelectedPriority] = useState<Priority>('normal');
  
  // UI state
  const [theme, setTheme] = useState<Theme>(getTimeBasedTheme());
  const [particles, setParticles] = useState<Particle[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  
  // Animation references
  const inputScale = useRef(new Animated.Value(1)).current;
  const headerOpacity = useRef(new Animated.Value(0)).current;
  
  // Shake detection state
  const shakeDetection = useRef(false);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Update theme periodically and animate header on mount
   */
  useEffect(() => {
    const interval = setInterval(() => {
      setTheme(getTimeBasedTheme());
    }, THEME_UPDATE_INTERVAL);
    
    Animated.timing(headerOpacity, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();

    return () => clearInterval(interval);
  }, [headerOpacity]);

  /**
   * Enable shake-to-shuffle functionality on mobile devices
   */
  useEffect(() => {
    if (Platform.OS === 'web') return;
    
    Accelerometer.setUpdateInterval(100);
    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      const acceleration = Math.sqrt(x * x + y * y + z * z);
      
      if (acceleration > SHAKE_THRESHOLD && !shakeDetection.current) {
        shakeDetection.current = true;
        shuffleTasks();
        setTimeout(() => {
          shakeDetection.current = false;
        }, SHAKE_COOLDOWN);
      }
    });

    return () => subscription?.remove();
  }, [tasks]);

  /**
   * Hide splash screen once fonts are loaded
   */
  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  // ============================================================================
  // Handlers
  // ============================================================================

  /**
   * Creates particle explosion effect at specified coordinates
   */
  const createParticles = useCallback((x: number, y: number) => {
    const newParticles: Particle[] = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const angle = (Math.PI * 2 * i) / PARTICLE_COUNT;
      const velocity = PARTICLE_VELOCITY_BASE + Math.random() * PARTICLE_VELOCITY_RANGE;
      
      const particle: Particle = {
        id: `${Date.now()}-${i}`,
        x: new Animated.Value(x),
        y: new Animated.Value(y),
        opacity: new Animated.Value(1),
        color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
      };
      
      Animated.parallel([
        Animated.timing(particle.x, {
          toValue: x + Math.cos(angle) * velocity,
          duration: PARTICLE_ANIMATION_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(particle.y, {
          toValue: y + Math.sin(angle) * velocity,
          duration: PARTICLE_ANIMATION_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(particle.opacity, {
          toValue: 0,
          duration: PARTICLE_ANIMATION_DURATION,
          useNativeDriver: true,
        }),
      ]).start();
      
      return particle;
    });
    
    setParticles(newParticles);
    setTimeout(() => setParticles([]), PARTICLE_ANIMATION_DURATION);
  }, []);

  /**
   * Shuffles task order randomly
   */
  const shuffleTasks = useCallback(() => {
    triggerHaptic('medium');
    setTasks(prev => [...prev].sort(() => Math.random() - 0.5));
  }, []);

  /**
   * Adds a new task with validation
   */
  const addTask = useCallback(() => {
    if (taskTitle.trim() === '') {
      triggerHaptic('error');
      Alert.alert('Empty Task', 'Please enter a task title');
      return;
    }

    triggerHaptic('light');
    
    const newTask: Task = {
      id: Date.now().toString(),
      title: taskTitle.trim(),
      description: taskDescription.trim(),
      completed: false,
      priority: selectedPriority,
    };

    setTasks(prev => [newTask, ...prev]);
    setTaskTitle('');
    setTaskDescription('');
    setSelectedPriority('normal');
    
    // Input feedback animation
    Animated.sequence([
      Animated.timing(inputScale, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(inputScale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, [taskTitle, taskDescription, selectedPriority, inputScale]);

  /**
   * Toggles task completion status with particle effect
   */
  const toggleTaskCompletion = useCallback((id: string, pageX: number, pageY: number) => {
    const task = tasks.find(t => t.id === id);
    
    if (task && !task.completed) {
      triggerHaptic('success');
      createParticles(pageX, pageY);
    } else {
      triggerHaptic('light');
    }
    
    setTasks(prev => 
      prev.map(task => 
        task.id === id ? { ...task, completed: !task.completed } : task
      )
    );
  }, [tasks, createParticles]);

  /**
   * Deletes a task with confirmation dialog
   */
  const deleteTask = useCallback((id: string) => {
    triggerHaptic('warning');
    
    const handleDelete = () => {
      triggerHaptic('success');
      setTasks(prev => prev.filter(task => task.id !== id));
    };
    
    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to delete this task?')) {
        handleDelete();
      } else {
        triggerHaptic('light');
      }
    } else {
      Alert.alert(
        'Delete Task',
        'Are you sure you want to delete this task?',
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => triggerHaptic('light'),
          },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: handleDelete,
          },
        ]
      );
    }
  }, []);

  /**
   * Updates task priority
   */
  const changePriority = useCallback((id: string, priority: Priority) => {
    triggerHaptic('light');
    setTasks(prev => 
      prev.map(task => 
        task.id === id ? { ...task, priority } : task
      )
    );
  }, []);

  /**
   * Opens task detail modal
   */
  const openTaskModal = useCallback((task: Task) => {
    setSelectedTask(task);
    setModalVisible(true);
    triggerHaptic('light');
  }, []);

  /**
   * Closes task detail modal
   */
  const closeModal = useCallback(() => {
    setModalVisible(false);
    setSelectedTask(null);
  }, []);

  // ============================================================================
  // Computed Values
  // ============================================================================

  /**
   * Tasks sorted by priority (urgent → low)
   */
  const sortedTasks = useMemo(() => {
    const priorityOrder: Record<Priority, number> = { 
      urgent: 0, 
      high: 1, 
      normal: 2, 
      low: 3 
    };
    return [...tasks].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  }, [tasks]);

  /**
   * Count of pending (incomplete) tasks
   */
  const pendingCount = useMemo(() => 
    tasks.filter(t => !t.completed).length, 
    [tasks]
  );

  // ============================================================================
  // Render Functions
  // ============================================================================

  /**
   * Renders individual task item
   */
  const renderTask = useCallback(({ item }: { item: Task }) => {
    const config = PRIORITY_CONFIG[item.priority];

    return (
      <View
        style={[
          styles.taskContainer,
          { borderLeftWidth: 4, borderLeftColor: config.color },
          config.glow && styles.urgentGlow,
        ]}
      >
        {/* Completion checkbox */}
        <TouchableOpacity
          onPress={(e) => {
            const { pageX, pageY } = e.nativeEvent;
            toggleTaskCompletion(item.id, pageX, pageY);
          }}
          style={[
            styles.taskCheckbox,
            { borderColor: config.color },
            item.completed && { backgroundColor: config.color },
          ]}
        >
          {item.completed && <Text style={styles.checkmark}>✓</Text>}
        </TouchableOpacity>

        {/* Task content */}
        <TouchableOpacity 
          style={styles.taskContent}
          onPress={() => openTaskModal(item)}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.taskTitle,
              { color: theme.text },
              item.completed && styles.taskTextCompleted,
            ]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          
          {item.description !== '' && (
            <Text
              style={[
                styles.taskDescription,
                { color: theme.text },
                item.completed && styles.taskTextCompleted,
              ]}
              numberOfLines={1}
            >
              {item.description}
            </Text>
          )}
          
          {/* Priority indicators */}
          <View style={styles.priorityContainer}>
            {PRIORITIES.map((priority) => (
              <TouchableOpacity
                key={priority}
                onPress={(e) => {
                  e.stopPropagation();
                  changePriority(item.id, priority);
                }}
                style={[
                  styles.priorityDot,
                  { 
                    backgroundColor: PRIORITY_CONFIG[priority].color,
                    opacity: item.priority === priority ? 1 : 0.3,
                  },
                ]}
              />
            ))}
          </View>
        </TouchableOpacity>

        {/* Delete button */}
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={(e) => {
            e.stopPropagation();
            deleteTask(item.id);
          }}
        >
          <Text style={styles.deleteButtonText}>✕</Text>
        </TouchableOpacity>
      </View>
    );
  }, [theme.text, toggleTaskCompletion, openTaskModal, changePriority, deleteTask]);

  // ============================================================================
  // Main Render
  // ============================================================================

  if (!fontsLoaded) {
    return null;
  }

  return (
    <LinearGradient colors={theme.colors} style={styles.container}>
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.container}
        >
          {/* Header */}
          <Animated.View style={[styles.header, { opacity: headerOpacity }]}>
            <Text style={[styles.title, { color: theme.text }]}>
              Task Manager
            </Text>
            <Text style={[styles.subtitle, { color: theme.text, opacity: 0.7 }]}>
              {theme.name} • {pendingCount} pending
            </Text>
          </Animated.View>

          {/* Task input section */}
          <Animated.View style={[styles.inputContainer, { transform: [{ scale: inputScale }] }]}>
            <View style={styles.inputSection}>
              <TextInput
                style={[styles.input, { color: theme.text }]}
                placeholder="Task title..."
                placeholderTextColor={theme.text === '#FFFFFF' ? '#999' : '#666'}
                value={taskTitle}
                onChangeText={setTaskTitle}
                returnKeyType="next"
              />
              <TextInput
                style={[styles.inputDescription, { color: theme.text }]}
                placeholder="Description (optional)..."
                placeholderTextColor={theme.text === '#FFFFFF' ? '#999' : '#666'}
                value={taskDescription}
                onChangeText={setTaskDescription}
                onSubmitEditing={addTask}
                returnKeyType="done"
              />
            </View>
            
            <View style={styles.actionsRow}>
              {/* Priority selector */}
              <View style={styles.prioritySelector}>
                {PRIORITIES.map((priority) => (
                  <TouchableOpacity
                    key={priority}
                    onPress={() => {
                      setSelectedPriority(priority);
                      triggerHaptic('light');
                    }}
                    style={[
                      styles.priorityButton,
                      {
                        backgroundColor: PRIORITY_CONFIG[priority].color,
                        opacity: selectedPriority === priority ? 1 : 0.4,
                        transform: [{ scale: selectedPriority === priority ? 1.2 : 1 }],
                      },
                    ]}
                  />
                ))}
              </View>

              {/* Add button */}
              <TouchableOpacity
                style={[styles.addButton, { backgroundColor: theme.accent }]}
                onPress={addTask}
              >
                <Text style={styles.addButtonText}>+</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>

          {/* Task list or empty state */}
          {tasks.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyStateText, { color: theme.text }]}>
                No tasks yet!
              </Text>
              <Text style={[styles.emptyStateSubtext, { color: theme.text, opacity: 0.6 }]}>
                Add your first task to get started
              </Text>
              {Platform.OS !== 'web' && (
                <Text style={[styles.emptyStateSubtext, { color: theme.text, opacity: 0.5, marginTop: 10 }]}>
                  💡 Shake your phone to shuffle tasks
                </Text>
              )}
            </View>
          ) : (
            <FlatList
              data={sortedTasks}
              renderItem={renderTask}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}

          {/* Particle animation overlay */}
          {particles.map((particle) => (
            <Animated.View
              key={particle.id}
              style={[
                styles.particle,
                {
                  backgroundColor: particle.color,
                  transform: [
                    { translateX: particle.x },
                    { translateY: particle.y },
                  ],
                  opacity: particle.opacity,
                },
              ]}
            />
          ))}

          {/* Task detail modal */}
          <Modal
            animationType="slide"
            transparent={true}
            visible={modalVisible}
            onRequestClose={closeModal}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Task Details</Text>
                  <TouchableOpacity onPress={closeModal} style={styles.closeButton}>
                    <Text style={styles.closeButtonText}>✕</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                  {selectedTask && (
                    <>
                      <View style={[
                        styles.modalPriorityBadge, 
                        { backgroundColor: PRIORITY_CONFIG[selectedTask.priority].color }
                      ]}>
                        <Text style={styles.modalPriorityText}>
                          {selectedTask.priority.toUpperCase()}
                        </Text>
                      </View>

                      <Text style={styles.modalTaskTitle}>{selectedTask.title}</Text>
                      
                      {selectedTask.description !== '' ? (
                        <>
                          <Text style={styles.modalSectionTitle}>Description</Text>
                          <Text style={styles.modalDescription}>{selectedTask.description}</Text>
                        </>
                      ) : (
                        <Text style={styles.modalNoDescription}>No description provided</Text>
                      )}

                      <View style={styles.modalFooter}>
                        <TouchableOpacity
                          style={[
                            styles.modalButton, 
                            { backgroundColor: selectedTask.completed ? '#A4B0BE' : '#10B981' }
                          ]}
                          onPress={() => {
                            toggleTaskCompletion(selectedTask.id, SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2);
                            closeModal();
                          }}
                        >
                          <Text style={styles.modalButtonText}>
                            {selectedTask.completed ? 'Mark Incomplete' : 'Mark Complete'}
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.modalButton, { backgroundColor: '#EF4444' }]}
                          onPress={() => {
                            closeModal();
                            setTimeout(() => deleteTask(selectedTask.id), 300);
                          }}
                        >
                          <Text style={styles.modalButtonText}>Delete Task</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </ScrollView>
              </View>
            </View>
          </Modal>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 20,
    paddingTop: 10,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 5,
    fontFamily: 'Montserrat_700Bold',
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Montserrat_400Regular',
  },
  inputContainer: {
    padding: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginHorizontal: 15,
    borderRadius: 15,
    marginBottom: 10,
  },
  inputSection: {
    marginBottom: 10,
  },
  input: {
    fontSize: 16,
    paddingVertical: 8,
    fontFamily: 'Montserrat_600SemiBold',
    marginBottom: 6,
  },
  inputDescription: {
    fontSize: 14,
    paddingVertical: 6,
    fontFamily: 'Montserrat_400Regular',
    opacity: 0.8,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  prioritySelector: {
    flexDirection: 'row',
    gap: 8,
  },
  priorityButton: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '300',
    fontFamily: 'Montserrat_600SemiBold',
  },
  listContent: {
    padding: 15,
  },
  taskContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
    color: "#000",
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  urgentGlow: {
    shadowColor: '#FF4757',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  taskCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: 'Montserrat_700Bold',
  },
  taskContent: {
    flex: 1,
    color: '#000',
  },
  taskTitle: {
    fontSize: 16,
    marginBottom: 4,
    fontFamily: 'Montserrat_600SemiBold',
  },
  taskDescription: {
    fontSize: 13,
    marginBottom: 6,
    fontFamily: 'Montserrat_400Regular',
    opacity: 0.7,
  },
  taskTextCompleted: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  priorityContainer: {
    flexDirection: 'row',
    gap: 5,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  deleteButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fee',
    borderRadius: 8,
  },
  deleteButtonText: {
    color: '#ef4444',
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: 'Montserrat_700Bold',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyStateText: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 8,
    fontFamily: 'Montserrat_600SemiBold',
  },
  emptyStateSubtext: {
    fontSize: 14,
    textAlign: 'center',
    fontFamily: 'Montserrat_400Regular',
  },
  particle: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: 'Montserrat_700Bold',
    color: '#1F2937',
  },
  closeButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 16,
  },
  closeButtonText: {
    fontSize: 20,
    color: '#6B7280',
    fontFamily: 'Montserrat_700Bold',
  },
  modalBody: {
    padding: 20,
  },
  modalPriorityBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 16,
  },
  modalPriorityText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'Montserrat_700Bold',
  },
  modalTaskTitle: {
    fontSize: 24,
    fontFamily: 'Montserrat_700Bold',
    color: '#1F2937',
    marginBottom: 16,
  },
  modalSectionTitle: {
    fontSize: 14,
    fontFamily: 'Montserrat_600SemiBold',
    color: '#6B7280',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  modalDescription: {
    fontSize: 16,
    fontFamily: 'Montserrat_400Regular',
    color: '#374151',
    lineHeight: 24,
    marginBottom: 24,
  },
  modalNoDescription: {
    fontSize: 14,
    fontFamily: 'Montserrat_400Regular',
    color: '#9CA3AF',
    fontStyle: 'italic',
    marginBottom: 24,
  },
  modalFooter: {
    gap: 12,
  },
  modalButton: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'Montserrat_600SemiBold',
  },
});
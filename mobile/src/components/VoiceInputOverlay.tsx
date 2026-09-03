import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  DeviceEventEmitter,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  NativeModules,
} from 'react-native';
import { Mic, X } from 'lucide-react-native';
import { useTheme } from '../providers';
import { audioRecorderService, type RecordingProgress } from '../services/audio/audioRecorderService';
import { aiService } from '../services/api/ai';

/** 全局快捷语音浮层。桌面组件、通知栏和边缘手势都在这里汇合，不再跳转 AI 页面。 */
export default function VoiceInputOverlay() {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState('按住说话，松开完成识别');
  const recordingRef = useRef(false);
  const bars = useRef(Array.from({ length: 18 }, () => new Animated.Value(0.35))).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  const stopAnimation = useCallback(() => {
    animationRef.current?.stop();
    animationRef.current = null;
    bars.forEach(bar => bar.setValue(0.35));
  }, [bars]);

  const close = useCallback(async () => {
    if (recordingRef.current) {
      recordingRef.current = false;
      setRecording(false);
      stopAnimation();
      setStatus('正在识别…');
      try {
        const result = await audioRecorderService.stopRecording();
        if (!result || result.duration < 0.5) {
          if (result) await audioRecorderService.deleteRecordingFile();
          setVisible(false);
          return;
        }
        const response = await aiService.transcribeAudio(result.base64, result.mimeType, result.filePath);
        await audioRecorderService.deleteRecordingFile();
        if (!response.success || !response.data?.text?.trim()) {
          setStatus(response.message || '没有识别到语音内容');
          return;
        }
        setStatus('正在记账…');
        const resultMessage = await aiService.sendMessage({ content: response.data.text.trim() });
        const created = resultMessage.data?.toolResults?.some(item => item.toolName === 'create_bills' && item.result?.success);
        if (created) DeviceEventEmitter.emit('onBillCreated');
        setStatus(created ? '记账成功' : (resultMessage.data?.content || '已完成'));
        setTimeout(() => setVisible(false), 900);
      } catch (error: any) {
        setStatus(error?.message || '语音处理失败，请重试');
      }
      return;
    }
    setVisible(false);
  }, [stopAnimation]);

  const start = useCallback(async () => {
    if (recordingRef.current) return;
    setVisible(true);
    setStatus('正在启动麦克风…');
    try {
      recordingRef.current = true;
      setRecording(true);
      setStatus('松开完成识别');
      animationRef.current = Animated.loop(Animated.stagger(45, bars.map(bar => Animated.sequence([
        Animated.timing(bar, { toValue: 0.95, duration: 180, useNativeDriver: true }),
        Animated.timing(bar, { toValue: 0.35, duration: 180, useNativeDriver: true }),
      ]))));
      animationRef.current.start();
      await audioRecorderService.startRecording((progress: RecordingProgress) => {
        const level = 0.35 + Math.min(0.6, (progress.currentMetering ?? 0.5) * 0.6);
        bars.forEach((bar, index) => bar.setValue(Math.max(0.3, Math.min(1, level + Math.sin(index) * 0.08))));
      });
    } catch (error: any) {
      recordingRef.current = false;
      setRecording(false);
      stopAnimation();
      setStatus(error?.message || '无法使用麦克风');
    }
  }, [bars, stopAnimation]);

  const request = useCallback(() => {
    if (visible) return;
    // 消费落盘请求，避免 Activity 重建后重复触发。
    NativeModules.VoiceShortcutModule?.consumePendingVoiceRequest?.().catch(() => undefined);
    start();
  }, [start, visible]);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('voiceInputRequested', request);
    NativeModules.VoiceShortcutModule?.consumePendingVoiceRequest?.().then((pending: boolean) => {
      if (pending) request();
    }).catch(() => undefined);
    return () => {
      subscription.remove();
      if (recordingRef.current) audioRecorderService.cancelRecording().catch(() => undefined);
      stopAnimation();
    };
  }, [request, stopAnimation]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.stroke }]}>
          <View style={[styles.icon, { backgroundColor: colors.primary }]}>
            {recording ? <Mic size={28} color="#fff" /> : <ActivityIndicator color="#fff" />}
          </View>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{recording ? '知账语音输入' : '知账正在处理'}</Text>
          <Text style={[styles.status, { color: colors.textSecondary }]}>{status}</Text>
          {recording && (
            <View style={styles.wave}>
              {bars.map((bar, index) => <Animated.View key={index} style={[styles.bar, { backgroundColor: colors.primary, transform: [{ scaleY: bar }] }]} />)}
            </View>
          )}
          <Pressable onPress={close} style={[styles.action, { backgroundColor: recording ? colors.primary : colors.stroke }]}>
            {recording ? <Text style={styles.actionText}>结束并识别</Text> : <X size={20} color="#fff" />}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  panel: { width: '100%', maxWidth: 360, borderWidth: 2, borderRadius: 24, padding: 26, alignItems: 'center', elevation: 12 },
  icon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontSize: 20, fontWeight: '800' },
  status: { marginTop: 8, fontSize: 14 },
  wave: { height: 56, flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 18 },
  bar: { width: 5, height: 46, borderRadius: 3 },
  action: { minWidth: 130, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginTop: 22, paddingHorizontal: 18 },
  actionText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

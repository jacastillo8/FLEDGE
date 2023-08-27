import torch, os
import torch.nn as nn
from torch.nn.functional import cosine_similarity
from torch.autograd import Variable
import numpy as np
from functools import reduce
from operator import __add__
from scipy.stats import gaussian_kde
from scipy.signal import argrelextrema

CIFAR10_NAMED_PARAMETERS = {'conv1.weight', 'conv1.bias', 'layer1.0.fn.0.weight', 'layer1.0.fn.0.bias', 'layer1.0.fn.2.weight', 'layer1.0.fn.2.bias', 
                            'layer1.1.weight', 'layer1.1.bias', 'layer1.3.weight', 'layer1.3.bias', 'layer2.0.fn.0.weight', 'layer2.0.fn.0.bias', 
                            'layer2.0.fn.2.weight', 'layer2.0.fn.2.bias', 'layer2.1.weight', 'layer2.1.bias', 'layer2.3.weight', 'layer2.3.bias',
                            'layer3.0.fn.0.weight', 'layer3.0.fn.0.bias', 'layer3.0.fn.2.weight', 'layer3.0.fn.2.bias', 'layer3.1.weight', 'layer3.1.bias', 
                            'layer3.3.weight', 'layer3.3.bias', 'fc.weight', 'fc.bias'}

MNIST_NAMED_PARAMETERS = {'layer1.0.weight', 'layer1.0.bias', 'fc.weight', 'fc.bias'}

FMNIST_NAMED_PARAMETERS = {'layer1.0.weight', 'layer1.0.bias', 'layer1.1.weight', 'layer1.1.bias', 'layer2.0.weight', 'layer2.0.bias', 'layer2.1.weight', 
                            'layer2.1.bias', 'fc.weight', 'fc.bias'}

class SimpleNet(nn.Module):
    def __init__(self, name=None, created_time=None):
        super(SimpleNet, self).__init__()
        self.created_time = created_time
        self.name = name

class FashionCNN(SimpleNet):
    def __init__(self, name = "CNN", created_time=None):
        super(FashionCNN, self).__init__(name, created_time)
        self.layer1 = nn.Sequential(
            nn.Conv2d(1, 16, kernel_size=5, padding=2),
            nn.BatchNorm2d(16),
            nn.ReLU(),
            nn.MaxPool2d(2))
        self.layer2 = nn.Sequential(
            nn.Conv2d(16, 32, kernel_size=5, padding=2),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.MaxPool2d(2))
        self.fc = nn.Linear(7*7*32, 10)
        
    def forward(self, x):
        out = self.layer1(x)
        out = self.layer2(out)
        out = out.view(out.size(0), -1)
        out = self.fc(out)
        return out

class MNISTCNN(SimpleNet):
    def __init__(self, name=None, created_time=None):
        super(MNISTCNN, self).__init__(name, created_time)
        self.layer1 = nn.Sequential(
            nn.Conv2d(1, 16, kernel_size=5, padding=0),
            nn.ReLU(),
            nn.MaxPool2d(2))
        self.fc = nn.Linear(12*12*16, 10)
        
    def forward(self, x):
        out = self.layer1(x)
        out = out.view(out.size(0), -1)
        out = self.fc(out)
        return out

class Conv2dSamePadding(nn.Conv2d):
    def __init__(self,*args,**kwargs):
        super(Conv2dSamePadding, self).__init__(*args, **kwargs)
        self.zero_pad_2d = nn.ZeroPad2d(reduce(__add__,
            [(k // 2 + (k - 2 * (k // 2)) - 1, k // 2) for k in self.kernel_size[::-1]]))

    def forward(self, input):
        return  self._conv_forward(self.zero_pad_2d(input), self.weight, self.bias)

class Residual(nn.Module):
    def __init__(self, fn):
        super().__init__()
        self.fn = fn

    def forward(self, x):
        return self.fn(x) + x
    
class ConvMixer_3(SimpleNet):
    def __init__(self, dim, kernel_size=9, patch_size=7, n_classes=1000, channels=3, name=None, created_time=None):
        super(ConvMixer_3, self).__init__(name, created_time)
        self.conv1 = nn.Conv2d(channels, dim, kernel_size=patch_size, stride=patch_size)
        self.gelu = nn.GELU()
        self.bn1 = nn.BatchNorm2d(dim)
        self.layer1 = self._make_layer(dim, kernel_size)
        self.layer2 = self._make_layer(dim, kernel_size)
        self.layer3 = self._make_layer(dim, kernel_size)
        self.pool = nn.AdaptiveAvgPool2d((1,1))
        self.flatten = nn.Flatten()
        self.fc = nn.Linear(dim, n_classes)

    def _make_layer(self, dim, kernel_size):
        return nn.Sequential(
                    Residual(nn.Sequential(
                        Conv2dSamePadding(dim, dim, kernel_size, groups=dim),
                        nn.GELU(),
                        nn.BatchNorm2d(dim)
                    )),
                    nn.Conv2d(dim, dim, kernel_size=1),
                    nn.GELU(),
                    nn.BatchNorm2d(dim)
                )
    
    def forward(self, x):
        out = self.bn1(self.gelu(self.conv1(x)))
        out = self.layer1(out)
        out = self.layer2(out)
        out = self.layer3(out)
        out = self.pool(out)
        out = self.flatten(out)
        out = self.fc(out)
        return out
    
def get_model_template(learning_task):
    if learning_task.lower() == 'mnist':
        model = MNISTCNN()
    elif learning_task.lower() == 'fashion':
        model = FashionCNN()
    elif learning_task.lower() == 'cifar10':
        model = ConvMixer_3(256, kernel_size=5, patch_size=3, n_classes=10, channels=3)
    return model

def extract_weights(model):
    """
    clones weights
    """
    result = {}
    if isinstance(model, dict):
        items = model.items()
    else:
        items = model.state_dict().items()

    for layer_name, local_layer in items:
        result[layer_name] = torch.tensor(local_layer).cpu().detach().clone()
    return result

def get_one_vec_sorted_layers(model, layer_names, size=None):
    """
    Converts a model, given as dictionary type, to a single vector
    """
    if size is None:
        size = 0
        for name in layer_names:
            size += model[name].view(-1).shape[0]
    sum_var = torch.FloatTensor(size).fill_(0)
    size = 0
    for name in layer_names:
        layer_as_vector = model[name].view(-1)
        layer_width = layer_as_vector.shape[0]
        sum_var[size:size + layer_width] = layer_as_vector
        size += layer_width
    return sum_var

def get_model(model_template, location):
    model_template.load_state_dict(torch.load('{}'.format(location), map_location=torch.device('cpu')))
    return extract_weights(model_template)

def get_sub_list(source, indices):
    return [source[i] for i in indices]

def cosine_between_models(m1, m2, learning_task='mnist'):
    if not isinstance(m1, dict):
        m1 = m1.state_dict()
    if not isinstance(m2, dict):
        m2 = m2.state_dict()
    if learning_task.lower() == 'mnist':
        named_params = MNIST_NAMED_PARAMETERS
    elif learning_task.lower() == 'fashion':
        named_params = FMNIST_NAMED_PARAMETERS
    elif learning_task.lower() == 'cifar10':
        named_params = CIFAR10_NAMED_PARAMETERS
    v1 = get_one_vec_sorted_layers(m1, named_params)
    v2 = get_one_vec_sorted_layers(m2, named_params)
    return cosine_similarity(v1, v2, dim=0).cpu()

def get_scores(global_model, local_models, learning_task='mnist'):
    scores = []
    for m in local_models:
        distance = cosine_between_models(global_model, m, learning_task)
        scores.append(1-distance)
    return scores

def get_kde(scores):
    kde = gaussian_kde(np.array(scores))
    xs = np.linspace(min(scores)-np.std(scores), max(scores)+np.std(scores), 2000)
    kde.covariance_factor = lambda : .5
    kde._compute_covariance()
    ys = kde(xs)
    return xs, ys

def get_data_groups(x, y, scores):
    mins = list(argrelextrema(y, np.less)[0])
    mins.append(len(x))
    initial = 0
    groups = {}
    for i, m in enumerate(mins):
        r = x[initial:m]
        indexes = []
        for j, s in enumerate(scores):
            if s >= min(r) and s <= max(r):
                indexes.append(j)
        groups[str(i)] = indexes
        initial = m
    return groups
        
def filter_scores(scores):
    xs, ys = get_kde(scores)
    groups = get_data_groups(xs, ys, scores)
    benign_key = str(min([int(k) for k in groups.keys()])) # closest to 0
    return groups[benign_key]

def evaluate_defense(learning_task, current_round):
    model_template = get_model_template(learning_task)
    model_dir = '../models/{}/pytorch_models'.format(learning_task)
    # Collect global model
    global_model = get_model(model_template, '{}/G{}.pt'.format(model_dir, current_round))
    local_models = []
    # Collect available local models
    for m in os.listdir(model_dir):
        # Provided global model has been trained for X rounds (GX)
        if m != 'G{}.pt'.format(current_round):
            model = get_model(model_template, '{}/{}'.format(model_dir, m))
            local_models.append(model)
    scores = get_scores(global_model, local_models, learning_task)
    ids = filter_scores(scores)
    # Selected MNIST Models (see below) can be used for aggregation 
    filtered_models = get_sub_list(local_models, ids)
    print('############ {} Learning Task - GKDE Defense ############'.format(learning_task))
    print('######### Benign_Length: {} - Malicious_Length: {} #########'.format(len(ids), len(scores) - len(ids)))
    return filtered_models

def main():
    mnist_filtered_models = evaluate_defense('MNIST', 5)
    fashion_filtered_models = evaluate_defense('Fashion', 5)
    cifar10_filtered_models = evaluate_defense('CIFAR10', 50)
   
if __name__ == '__main__':
    main()
    